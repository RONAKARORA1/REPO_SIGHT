#include "parser/JavaParser.h"
 
#include <unordered_set>
#include <utility>
 
namespace cma {
 
JavaParser::JavaParser(const std::vector<Token>& tokens, int totalLines)
    : m_tokens(tokens)
    , m_totalLines(totalLines)
{
    m_lineTypes.assign(static_cast<std::size_t>(totalLines), LineType::BLANK);
    m_result.totalLines = totalLines;
}
 
FileMetrics JavaParser::analyze() {
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
 
void JavaParser::classifyLines() {
    const auto mark = [&](int srcLine, LineType lt) {
        const auto idx = static_cast<std::size_t>(srcLine - 1);
        if (idx >= m_lineTypes.size()) return;
        if (lt == LineType::CODE ||
            (lt == LineType::COMMENT && m_lineTypes[idx] == LineType::BLANK)) {
            m_lineTypes[idx] = lt;
        }
    };
 
    for (const auto& tok : m_tokens) {
        if (tok.type == TokenType::END_OF_FILE || tok.type == TokenType::NEWLINE)
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
 
        } else if (tok.type == TokenType::STRING_LITERAL) {
            int line = tok.line;
            for (char c : tok.value) {
                mark(line, LineType::CODE);
                if (c == '\n') ++line;
            }
 
        } else {
            mark(tok.line, LineType::CODE);
        }
    }
}
 
void JavaParser::walkTokens() {
    const std::size_t n = m_tokens.size();
    int lastLine = 0;
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = m_tokens[i];
        if (tok.type != TokenType::END_OF_FILE) lastLine = tok.line;
 
        switch (tok.type) {
 
        case TokenType::OPEN_BRACE:
            m_braceAnalyzer.onOpenBrace();
            break;
 
        case TokenType::CLOSE_BRACE:
            if (!m_fnStack.empty() &&
                m_braceAnalyzer.depth() == m_fnStack.back().bodyBraceDepth) {
                m_fnStack.back().info.endLine = tok.line;
                m_result.functions.push_back(m_fnStack.back().info);
                m_fnStack.pop_back();
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
 
    while (!m_fnStack.empty()) {
        m_fnStack.back().info.endLine = lastLine;
        m_result.functions.push_back(m_fnStack.back().info);
        m_fnStack.pop_back();
    }
}
 
void JavaParser::handleKeyword(std::size_t idx) {
    const Token& tok = m_tokens[idx];
    const std::string& v = tok.value;
 
    if (v == "for" || v == "while" || v == "do") {
        ++m_result.loopCount;
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "if" || v == "switch") {
        ++m_result.conditionCount;
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "case") {
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "catch") {
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "try") {
        ++m_result.tryCatchCount;
 
    } else if (v == "class" || v == "interface" || v == "enum" || v == "record") {
        tryRecordClass(idx, v);
 
    } else if (v == "import") {
        ++m_result.includeCount;
        m_result.includeTargets.push_back(extractImportTarget(idx));
    }
}
 
void JavaParser::tryBeginFunction(std::size_t identIdx) {
    if (identIdx > 0) {
        const Token& prev = m_tokens[identIdx - 1];
        if (prev.type == TokenType::KEYWORD &&
            (prev.value == "new"       || prev.value == "class" ||
             prev.value == "interface" || prev.value == "enum"  ||
             prev.value == "record")) {
            return;
        }
    }
 
    const std::size_t openParenIdx  = identIdx + 1;
    const std::size_t closeParenIdx = findMatchingParen(openParenIdx);
    if (closeParenIdx >= m_tokens.size()) return;
 
    const std::size_t bodyIdx = skipTrailingSpecifiers(closeParenIdx + 1);
    if (bodyIdx >= m_tokens.size()) return;
    if (m_tokens[bodyIdx].type != TokenType::OPEN_BRACE) return;
 
    PendingFunction pf;
    pf.info.name      = m_tokens[identIdx].value;
    pf.info.startLine = m_tokens[identIdx].line;
    pf.bodyBraceDepth = m_braceAnalyzer.depth() + 1;
    m_fnStack.push_back(std::move(pf));
}
 
void JavaParser::tryRecordClass(std::size_t kwIdx, const std::string& kwValue) {
    const std::size_t nameIdx = kwIdx + 1;
    if (nameIdx < m_tokens.size() && m_tokens[nameIdx].type == TokenType::IDENTIFIER) {
        ClassInfo ci;
        ci.name = m_tokens[nameIdx].value;
        ci.line = m_tokens[kwIdx].line;
        if      (kwValue == "class")     ci.kind = ClassInfo::Kind::CLASS;
        else if (kwValue == "interface") ci.kind = ClassInfo::Kind::CLASS;
        else if (kwValue == "enum")      ci.kind = ClassInfo::Kind::ENUM;
        else                              ci.kind = ClassInfo::Kind::STRUCT;
        m_result.classes.push_back(ci);
    }
}
 
void JavaParser::handleVariableDecl(std::size_t identIdx) {
    static const std::unordered_set<std::string> kPrimitiveTypes = {
        "byte","short","int","long","float","double","boolean","char","var"
    };
 
    if (identIdx == 0) return;
 
    std::size_t prev = identIdx - 1;
    if (m_tokens[prev].type == TokenType::KEYWORD &&
        m_tokens[prev].value == "final" && prev > 0) {
        --prev;
    }
 
    if (m_tokens[prev].type != TokenType::KEYWORD) return;
    if (!kPrimitiveTypes.count(m_tokens[prev].value)) return;
 
    const std::size_t next = identIdx + 1;
    if (next < m_tokens.size() &&
        m_tokens[next].type == TokenType::OPEN_PAREN) return;
 
    ++m_result.variableCount;
}
 
std::string JavaParser::extractImportTarget(std::size_t kwIdx) const {
    std::size_t i = kwIdx + 1;
 
    if (i < m_tokens.size() &&
        m_tokens[i].type == TokenType::KEYWORD && m_tokens[i].value == "static") {
        ++i;
    }
 
    std::string target;
    while (i < m_tokens.size()) {
        const Token& t = m_tokens[i];
        if (t.type == TokenType::IDENTIFIER) {
            target += t.value;
        } else if (t.type == TokenType::OPERATOR && (t.value == "." || t.value == "*")) {
            target += t.value;
        } else {
            break;
        }
        ++i;
    }
    return target;
}
 
std::size_t JavaParser::findMatchingParen(std::size_t openIdx) const {
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
 
std::size_t JavaParser::skipTrailingSpecifiers(std::size_t i) const {
    const std::size_t n = m_tokens.size();
 
    while (i < n) {
        const Token& t = m_tokens[i];
 
        if (t.type == TokenType::NEWLINE) { ++i; continue; }
 
        if (t.type == TokenType::KEYWORD && t.value == "throws") {
            ++i;
            while (i < n &&
                   m_tokens[i].type != TokenType::OPEN_BRACE &&
                   m_tokens[i].type != TokenType::SEMICOLON) {
                ++i;
            }
            continue;
        }
 
        break;
    }
    return i;
}
 
int JavaParser::countTodos(const std::string& text) const {
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
 
