#include "parser/CppParser.h"
 
#include <algorithm>
#include <cctype>
#include <unordered_set>
 
namespace cma {
 
namespace {
 
// Extracts the target of a #include directive's raw text for the
// dependency-graph metric (Phase 4 Sprint 2). Only quoted includes are
// resolvable to a local project file; angle-bracket includes return an
// empty string.
std::string extractCppIncludeTarget(const std::string& directive) {
    auto pos = directive.find("include");
    if (pos == std::string::npos) return {};
    pos += 7;
    while (pos < directive.size() &&
           std::isspace(static_cast<unsigned char>(directive[pos]))) {
        ++pos;
    }
    if (pos >= directive.size() || directive[pos] != '"') return {};
    const auto end = directive.find('"', pos + 1);
    if (end == std::string::npos) return {};
    return directive.substr(pos + 1, end - pos - 1);
}
 
} // anonymous namespace
 
const FunctionInfo* FileMetrics::longestFunction() const noexcept {
    if (functions.empty()) return nullptr;
    return &*std::max_element(
        functions.begin(), functions.end(),
        [](const FunctionInfo& a, const FunctionInfo& b) {
            return a.lineCount() < b.lineCount();
        });
}
 
double FileMetrics::avgFunctionLength() const noexcept {
    if (functions.empty()) return 0.0;
    double total = 0.0;
    for (const auto& fn : functions) total += fn.lineCount();
    return total / static_cast<double>(functions.size());
}
 
CppParser::CppParser(const std::vector<Token>& tokens, int totalLines)
    : m_tokens(tokens)
    , m_totalLines(totalLines)
{
    m_lineTypes.assign(static_cast<std::size_t>(totalLines), LineType::BLANK);
    m_result.totalLines = totalLines;
}
 
FileMetrics CppParser::analyze() {
    classifyLines();
    walkTokens();
 
    for (const auto& lt : m_lineTypes) {
        switch (lt) {
            case LineType::BLANK:   ++m_result.blankLines;   break;
            case LineType::COMMENT: ++m_result.commentLines; break;
            case LineType::CODE:    ++m_result.codeLines;    break;
        }
    }
 
    m_result.maxNestingDepth = m_braceAnalyzer.maxDepth();
    return m_result;
}
 
void CppParser::classifyLines() {
    const auto mark = [&](int srcLine, LineType lt) {
        const auto idx = static_cast<std::size_t>(srcLine - 1);
        if (idx >= m_lineTypes.size()) return;
        if (lt == LineType::CODE ||
            (lt == LineType::COMMENT && m_lineTypes[idx] == LineType::BLANK)) {
            m_lineTypes[idx] = lt;
        }
    };
 
    for (const auto& tok : m_tokens) {
        if (tok.type == TokenType::END_OF_FILE ||
            tok.type == TokenType::NEWLINE)
            continue;
 
        if (tok.type == TokenType::LINE_COMMENT) {
            mark(tok.line, LineType::COMMENT);
            m_result.todoCount += countTodos(tok.value);
 
        } else if (tok.type == TokenType::BLOCK_COMMENT) {
            int line = tok.line;
            for (char c : tok.value) {
                mark(line, LineType::COMMENT);
                if (c == '\n') ++line;
            }
            m_result.todoCount += countTodos(tok.value);
 
        } else if (tok.type == TokenType::PREPROCESSOR) {
            mark(tok.line, LineType::CODE);
            if (tok.value.find("#include") != std::string::npos) {
                ++m_result.includeCount;
                m_result.includeTargets.push_back(extractCppIncludeTarget(tok.value));
            }
 
        } else {
            mark(tok.line, LineType::CODE);
        }
    }
}
 
void CppParser::walkTokens() {
    const std::size_t n = m_tokens.size();
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = m_tokens[i];
 
        switch (tok.type) {
 
        case TokenType::OPEN_BRACE:
            m_braceAnalyzer.onOpenBrace();
            break;
 
        case TokenType::CLOSE_BRACE:
            if (m_inFunction && m_braceAnalyzer.depth() == m_fnBraceDepth) {
                m_currentFn.endLine = tok.line;
                m_result.functions.push_back(m_currentFn);
                m_inFunction = false;
            }
            m_braceAnalyzer.onCloseBrace();
            break;
 
        case TokenType::KEYWORD:
            handleKeyword(i);
            break;
 
        case TokenType::IDENTIFIER:
            if (i + 1 < n && m_tokens[i + 1].type == TokenType::OPEN_PAREN)
                tryBeginFunction(i);
            else
                handleVariableDecl(i);
            break;
 
        case TokenType::OPERATOR:
            if (tok.value == "?") {
                ++m_result.cyclomaticComplexity;
            }
            else if ((tok.value == "&" || tok.value == "|") &&
                      i + 1 < n &&
                      m_tokens[i + 1].type  == TokenType::OPERATOR &&
                      m_tokens[i + 1].value == tok.value) {
                ++m_result.cyclomaticComplexity;
                ++i;
            }
            break;
 
        default:
            break;
        }
    }
}
 
void CppParser::handleKeyword(std::size_t idx) {
    const Token& tok = m_tokens[idx];
 
    if (isLoopKeyword(tok)) {
        ++m_result.loopCount;
        ++m_result.cyclomaticComplexity;
 
    } else if (isCondKeyword(tok)) {
        ++m_result.conditionCount;
        ++m_result.cyclomaticComplexity;
 
    } else if (tok.value == "case") {
        ++m_result.cyclomaticComplexity;
 
    } else if (tok.value == "catch") {
        ++m_result.cyclomaticComplexity;
 
    } else if (tok.value == "try") {
        ++m_result.tryCatchCount;
 
    } else if (isClassLike(tok)) {
        const std::size_t nameIdx = idx + 1;
        if (nameIdx < m_tokens.size() &&
            m_tokens[nameIdx].type == TokenType::IDENTIFIER) {
            ClassInfo ci;
            ci.name = m_tokens[nameIdx].value;
            ci.line = tok.line;
            if      (tok.value == "class")     ci.kind = ClassInfo::Kind::CLASS;
            else if (tok.value == "struct")    ci.kind = ClassInfo::Kind::STRUCT;
            else if (tok.value == "enum")      ci.kind = ClassInfo::Kind::ENUM;
            else                               ci.kind = ClassInfo::Kind::NAMESPACE;
            m_result.classes.push_back(ci);
        }
    }
}
 
void CppParser::tryBeginFunction(std::size_t identIdx) {
    if (m_inFunction || m_braceAnalyzer.depth() > 1) return;
 
    const std::size_t openParenIdx  = identIdx + 1;
    const std::size_t closeParenIdx = findMatchingParen(openParenIdx);
    if (closeParenIdx >= m_tokens.size()) return;
 
    const std::size_t bodyIdx = skipTrailingSpecifiers(closeParenIdx + 1);
    if (bodyIdx >= m_tokens.size()) return;
    if (m_tokens[bodyIdx].type != TokenType::OPEN_BRACE) return;
 
    m_inFunction   = true;
    m_fnBraceDepth = m_braceAnalyzer.depth() + 1;
    m_currentFn    = {};
    m_currentFn.name      = m_tokens[identIdx].value;
    m_currentFn.startLine = m_tokens[identIdx].line;
}
 
void CppParser::handleVariableDecl(std::size_t identIdx) {
    static const std::unordered_set<std::string> kPrimitiveTypes = {
        "int","long","short","char","bool","float","double",
        "unsigned","signed","auto","wchar_t","size_t","void"
    };
 
    if (identIdx == 0) return;
 
    std::size_t prev = identIdx - 1;
    while (prev > 0 &&
           m_tokens[prev].type == TokenType::OPERATOR &&
           (m_tokens[prev].value == "*" || m_tokens[prev].value == "&")) {
        --prev;
    }
    if (m_tokens[prev].type == TokenType::KEYWORD &&
        m_tokens[prev].value == "const" && prev > 0) {
        --prev;
    }
 
    if (m_tokens[prev].type != TokenType::KEYWORD) return;
    if (!kPrimitiveTypes.count(m_tokens[prev].value)) return;
 
    const std::size_t next = identIdx + 1;
    if (next < m_tokens.size() &&
        m_tokens[next].type == TokenType::OPEN_PAREN) return;
 
    ++m_result.variableCount;
}
 
std::size_t CppParser::findMatchingParen(std::size_t openIdx) const {
    if (openIdx >= m_tokens.size() ||
        m_tokens[openIdx].type != TokenType::OPEN_PAREN)
        return m_tokens.size();
 
    int depth = 1;
    for (std::size_t i = openIdx + 1; i < m_tokens.size(); ++i) {
        if (m_tokens[i].type == TokenType::OPEN_PAREN)  ++depth;
        if (m_tokens[i].type == TokenType::CLOSE_PAREN) { if (--depth == 0) return i; }
        if (m_tokens[i].type == TokenType::END_OF_FILE) break;
    }
    return m_tokens.size();
}
 
std::size_t CppParser::skipTrailingSpecifiers(std::size_t i) const {
    static const std::unordered_set<std::string> kSpecifiers = {
        "const","noexcept","override","final","volatile","mutable","requires"
    };
 
    const std::size_t n = m_tokens.size();
    int parenDepth = 0;
 
    while (i < n) {
        const Token& t = m_tokens[i];
 
        if (t.type == TokenType::NEWLINE) { ++i; continue; }
 
        if (t.type == TokenType::OPEN_PAREN)  { ++parenDepth; ++i; continue; }
        if (t.type == TokenType::CLOSE_PAREN) { --parenDepth; ++i; continue; }
        if (parenDepth > 0) { ++i; continue; }
 
        if (t.type == TokenType::KEYWORD && kSpecifiers.count(t.value)) {
            ++i; continue;
        }
 
        if (t.type == TokenType::OPERATOR && t.value == ":") {
            while (i < n && m_tokens[i].type != TokenType::OPEN_BRACE) ++i;
            break;
        }
 
        if (t.type == TokenType::OPERATOR && t.value == "-" &&
            i + 1 < n && m_tokens[i + 1].value == ">") {
            i += 2;
            while (i < n) {
                const auto& rt = m_tokens[i];
                if (rt.type == TokenType::OPEN_BRACE ||
                    rt.type == TokenType::SEMICOLON)
                    break;
                ++i;
            }
            continue;
        }
 
        break;
    }
    return i;
}
 
int CppParser::countTodos(const std::string& text) const {
    int count = 0;
    for (std::size_t pos = 0;
         (pos = text.find("TODO", pos)) != std::string::npos;
         pos += 4) { ++count; }
    for (std::size_t pos = 0;
         (pos = text.find("FIXME", pos)) != std::string::npos;
         pos += 5) { ++count; }
    return count;
}
 
} // namespace cma
 
