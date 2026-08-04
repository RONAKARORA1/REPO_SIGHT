#include "rules/JavaRules.h"
 
#include <cctype>
#include <unordered_set>
 
namespace cma {
 
namespace {
 
constexpr int kLongFunctionThreshold = 100;
constexpr int kDeepNestingThreshold  = 6;
 
const std::unordered_set<std::string> kRawTypeNames = {
    "List", "Map", "Set", "ArrayList", "HashMap", "HashSet",
    "LinkedList", "TreeMap", "TreeSet"
};
 
bool hasTicketReference(const std::string& text) {
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '#' && i + 1 < text.size() &&
            std::isdigit(static_cast<unsigned char>(text[i + 1]))) {
            return true;
        }
    }
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (std::isupper(static_cast<unsigned char>(text[i]))) {
            std::size_t j = i;
            while (j < text.size() && std::isupper(static_cast<unsigned char>(text[j]))) ++j;
            if (j < text.size() && text[j] == '-' && j + 1 < text.size() &&
                std::isdigit(static_cast<unsigned char>(text[j + 1]))) {
                return true;
            }
            i = j;
        }
    }
    return false;
}
 
Violation makeViolation(const std::string& path, int line, const std::string& ruleId,
                         std::string message, const std::string& severity) {
    Violation v;
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "java";
    v.message = std::move(message); v.severity = severity;
    return v;
}
 
} // anonymous namespace
 
std::vector<Violation> checkJavaRules(const std::string& path, const std::vector<Token>& tokens,
                                        const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];
 
        // java-empty-catch-block: catch ( ... ) { [NEWLINE]* }
        if (tok.type == TokenType::KEYWORD && tok.value == "catch" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPEN_PAREN) {
            std::size_t j = i + 2;
            int depth = 1;
            while (j < n && depth > 0) {
                if (tokens[j].type == TokenType::OPEN_PAREN) ++depth;
                else if (tokens[j].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                ++j;
            }
            if (j + 1 < n && tokens[j + 1].type == TokenType::OPEN_BRACE) {
                std::size_t k = j + 2;
                while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
                if (k < n && tokens[k].type == TokenType::CLOSE_BRACE) {
                    out.push_back(makeViolation(path, tok.line, "java-empty-catch-block",
                        "Empty catch block silently swallows the exception", "warning"));
                }
            }
        }
 
        // java-public-field: public [modifiers] TYPE name (=|;|,)  -- excludes
        // public static final constants and methods.
        if (tok.type == TokenType::KEYWORD && tok.value == "public") {
            std::size_t j = i + 1;
            bool isStatic = false, isFinal = false;
            while (j < n && tokens[j].type == TokenType::KEYWORD &&
                   (tokens[j].value == "static" || tokens[j].value == "final" ||
                    tokens[j].value == "volatile" || tokens[j].value == "transient" ||
                    tokens[j].value == "abstract" || tokens[j].value == "synchronized")) {
                if (tokens[j].value == "static") isStatic = true;
                if (tokens[j].value == "final")  isFinal  = true;
                ++j;
            }
            if (!(isStatic && isFinal)) {
                std::size_t k = j;
                int depth = 0;
                std::size_t nameIdx = n;
                while (k < n) {
                    const Token& t = tokens[k];
                    if (t.type == TokenType::OPERATOR && t.value == "<") { ++depth; ++k; continue; }
                    if (t.type == TokenType::OPERATOR && t.value == ">") { if (depth > 0) --depth; ++k; continue; }
                    if (t.type == TokenType::OPEN_BRACKET)  { ++depth; ++k; continue; }
                    if (t.type == TokenType::CLOSE_BRACKET) { if (depth > 0) --depth; ++k; continue; }
                    if (depth == 0 &&
                        (t.type == TokenType::SEMICOLON ||
                         (t.type == TokenType::OPERATOR && t.value == "=") ||
                         t.type == TokenType::OPEN_PAREN ||
                         (t.type == TokenType::PUNCTUATION && t.value == ","))) {
                        break;
                    }
                    if (depth == 0 && t.type == TokenType::IDENTIFIER) nameIdx = k;
                    ++k;
                }
                if (nameIdx < n && k < n && tokens[k].type != TokenType::OPEN_PAREN) {
                    out.push_back(makeViolation(path, tokens[nameIdx].line, "java-public-field",
                        "Public field '" + tokens[nameIdx].value +
                        "' breaks encapsulation -- consider a private field with accessors", "info"));
                }
            }
        }
 
        // java-printstacktrace: '.' 'printStackTrace' '('
        if (tok.type == TokenType::OPERATOR && tok.value == "." &&
            i + 2 < n &&
            tokens[i + 1].type == TokenType::IDENTIFIER && tokens[i + 1].value == "printStackTrace" &&
            tokens[i + 2].type == TokenType::OPEN_PAREN) {
            out.push_back(makeViolation(path, tokens[i + 1].line, "java-printstacktrace",
                "printStackTrace() dumps to stderr and is easy to lose in production -- use a logger",
                "info"));
        }
 
        // java-raw-type-usage
        if (tok.type == TokenType::IDENTIFIER && kRawTypeNames.count(tok.value)) {
            const bool followedByGeneric = (i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR &&
                                             tokens[i + 1].value == "<");
            const bool followedByDot = (i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR &&
                                         tokens[i + 1].value == ".");
            if (!followedByGeneric && !followedByDot) {
                const bool precededByNew = (i > 0 && tokens[i - 1].type == TokenType::KEYWORD &&
                                             tokens[i - 1].value == "new");
                const bool rawInstantiation = precededByNew && i + 1 < n &&
                                               tokens[i + 1].type == TokenType::OPEN_PAREN;
                const bool rawDeclaration = (i + 1 < n && tokens[i + 1].type == TokenType::IDENTIFIER);
                if (rawInstantiation || rawDeclaration) {
                    out.push_back(makeViolation(path, tok.line, "java-raw-type-usage",
                        "Raw type '" + tok.value + "' used without a generic parameter -- prefer "
                        "'" + tok.value + "<T>' for compile-time type safety", "info"));
                }
            }
        }
    }
 
    // java-long-method
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "java-long-method",
                "Method '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }
 
    // java-deep-nesting
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "java-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper methods", "info"));
    }
 
    // java-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT && tok.type != TokenType::BLOCK_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "java-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }
 
    return out;
}
 
} // namespace cma
 
