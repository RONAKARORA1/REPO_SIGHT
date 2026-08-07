#include "rules/PythonRules.h"
 
#include <cctype>
 
namespace cma {
 
namespace {
 
constexpr int kLongFunctionThreshold = 100;
constexpr int kDeepNestingThreshold  = 6;
 
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
    v.path = path; v.line = line; v.ruleId = ruleId; v.language = "python";
    v.message = std::move(message); v.severity = severity;
    return v;
}
 
} // anonymous namespace
 
std::vector<Violation> checkPythonRules(const std::string& path, const std::vector<Token>& tokens,
                                          const FileMetrics& fm) {
    std::vector<Violation> out;
    const std::size_t n = tokens.size();
 
    struct ClassFrame { int bodyColumn; bool sawDef; };
    std::vector<ClassFrame> classStack;
 
    bool atStatementStart = true;
    bool pendingClassHeader = false;
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = tokens[i];
 
        if (tok.type == TokenType::NEWLINE) { atStatementStart = true; continue; }
        if (tok.type == TokenType::END_OF_FILE) break;
 
        if (atStatementStart) {
            // Strictly-less-than: a statement sitting AT the class body's
            // own column is still inside the class (it's the body's first
            // line); only a shallower column is a real dedent out of it.
            while (!classStack.empty() && tok.col < classStack.back().bodyColumn) {
                classStack.pop_back();
            }
        }
 
        // py-bare-except: 'except' directly followed by ':'
        if (tok.type == TokenType::KEYWORD && tok.value == "except" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == ":") {
            out.push_back(makeViolation(path, tok.line, "py-bare-except",
                "Bare 'except:' catches every exception including KeyboardInterrupt/SystemExit "
                "-- catch a specific exception type", "warning"));
        }
 
        // py-wildcard-import: 'import' immediately followed by '*'
        if (tok.type == TokenType::KEYWORD && tok.value == "import" &&
            i + 1 < n && tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "*") {
            out.push_back(makeViolation(path, tok.line, "py-wildcard-import",
                "Wildcard import pollutes the namespace and hides where names come from", "warning"));
        }
 
        // py-mutable-default-arg
        if (tok.type == TokenType::KEYWORD && tok.value == "def") {
            std::size_t j = i + 1;
            while (j < n && tokens[j].type != TokenType::OPEN_PAREN && tokens[j].type != TokenType::NEWLINE) ++j;
            if (j < n && tokens[j].type == TokenType::OPEN_PAREN) {
                int depth = 1;
                std::size_t k = j + 1;
                while (k < n && depth > 0) {
                    if (tokens[k].type == TokenType::OPEN_PAREN) ++depth;
                    else if (tokens[k].type == TokenType::CLOSE_PAREN) { --depth; if (depth == 0) break; }
                    else if (tokens[k].type == TokenType::OPERATOR && tokens[k].value == "=" &&
                             k + 1 < n &&
                             (tokens[k + 1].type == TokenType::OPEN_BRACKET ||
                              tokens[k + 1].type == TokenType::OPEN_BRACE)) {
                        out.push_back(makeViolation(path, tok.line, "py-mutable-default-arg",
                            "Mutable default argument is shared across every call -- use None and "
                            "create the default inside the function", "warning"));
                    }
                    ++k;
                }
            }
        }
 
        // Class-body tracking, feeds py-mutable-class-attribute
        if (tok.type == TokenType::KEYWORD && tok.value == "class") {
            pendingClassHeader = true;
        }
        if (pendingClassHeader && tok.type == TokenType::OPERATOR && tok.value == ":") {
            pendingClassHeader = false;
            std::size_t k = i + 1;
            while (k < n && tokens[k].type == TokenType::NEWLINE) ++k;
            if (k < n) classStack.push_back(ClassFrame{tokens[k].col, false});
        }
 
        if (atStatementStart && !classStack.empty() && tok.col == classStack.back().bodyColumn) {
            if (tok.type == TokenType::KEYWORD && tok.value == "def") {
                classStack.back().sawDef = true;
            } else if (!classStack.back().sawDef &&
                       tok.type == TokenType::IDENTIFIER &&
                       i + 2 < n &&
                       tokens[i + 1].type == TokenType::OPERATOR && tokens[i + 1].value == "=" &&
                       (tokens[i + 2].type == TokenType::OPEN_BRACKET ||
                        tokens[i + 2].type == TokenType::OPEN_BRACE)) {
                out.push_back(makeViolation(path, tok.line, "py-mutable-class-attribute",
                    "Class-level mutable attribute is shared by every instance -- initialize it in "
                    "__init__ instead", "warning"));
            }
        }
 
        atStatementStart = false;
    }
 
    // py-long-function
    for (const auto& fn : fm.functions) {
        if (fn.lineCount() > kLongFunctionThreshold) {
            out.push_back(makeViolation(path, fn.startLine, "py-long-function",
                "Function '" + fn.name + "' is " + std::to_string(fn.lineCount()) +
                " lines -- consider splitting it", "info"));
        }
    }
 
    // py-deep-nesting
    if (fm.maxNestingDepth > kDeepNestingThreshold) {
        out.push_back(makeViolation(path, 0, "py-deep-nesting",
            "File reaches nesting depth " + std::to_string(fm.maxNestingDepth) +
            " -- consider extracting helper functions", "info"));
    }
 
    // py-todo-without-ticket
    for (const auto& tok : tokens) {
        if (tok.type != TokenType::LINE_COMMENT) continue;
        const bool hasTodo = tok.value.find("TODO") != std::string::npos ||
                              tok.value.find("FIXME") != std::string::npos;
        if (!hasTodo || hasTicketReference(tok.value)) continue;
        out.push_back(makeViolation(path, tok.line, "py-todo-without-ticket",
            "TODO/FIXME without a ticket reference (#123 or PROJ-123)", "info"));
    }
 
    return out;
}
 
} // namespace cma
 
