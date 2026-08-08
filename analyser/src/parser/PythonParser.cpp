#include "parser/PythonParser.h"
 
#include <utility>
 
namespace cma {
 
PythonParser::PythonParser(const std::vector<Token>& tokens, int totalLines)
    : m_tokens(tokens)
    , m_totalLines(totalLines)
{
    m_lineTypes.assign(static_cast<std::size_t>(totalLines), LineType::BLANK);
    m_result.totalLines = totalLines;
}
 
FileMetrics PythonParser::analyze() {
    classifyLines();
    walkTokens();
 
    for (const auto& lt : m_lineTypes) {
        switch (lt) {
            case LineType::BLANK:   ++m_result.blankLines;   break;
            case LineType::COMMENT: ++m_result.commentLines; break;
            case LineType::CODE:    ++m_result.codeLines;    break;
        }
    }
 
    m_result.maxNestingDepth = m_indentAnalyzer.maxDepth();
    return m_result;
}
 
void PythonParser::classifyLines() {
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
 
void PythonParser::walkTokens() {
    const std::size_t n = m_tokens.size();
 
    for (std::size_t i = 0; i < n; ++i) {
        const Token& tok = m_tokens[i];
 
        if (tok.type == TokenType::NEWLINE) {
            m_atStatementStart = true;
            continue;
        }
        if (tok.type == TokenType::END_OF_FILE) break;
 
        const auto lineIdx = static_cast<std::size_t>(tok.line - 1);
        const bool onCodeLine =
            lineIdx < m_lineTypes.size() && m_lineTypes[lineIdx] == LineType::CODE;
 
        if (onCodeLine && tok.line != m_lastIndentLine) {
            processIndentForLine(tok.col);
            m_lastIndentLine = tok.line;
        }
        if (onCodeLine) {
            m_lastCodeLine = tok.line;
        }
 
        switch (tok.type) {
            case TokenType::OPEN_PAREN:
            case TokenType::OPEN_BRACKET:
            case TokenType::OPEN_BRACE:
                ++m_bracketDepth;
                break;
 
            case TokenType::CLOSE_PAREN:
            case TokenType::CLOSE_BRACKET:
            case TokenType::CLOSE_BRACE:
                if (m_bracketDepth > 0) --m_bracketDepth;
                break;
 
            case TokenType::KEYWORD:
                handleKeyword(i);
                break;
 
            case TokenType::IDENTIFIER:
                handleAssignment(i);
                break;
 
            default:
                break;
        }
 
        m_atStatementStart = false;
    }
 
    while (!m_fnStack.empty()) {
        m_fnStack.back().info.endLine = m_lastCodeLine;
        m_result.functions.push_back(m_fnStack.back().info);
        m_fnStack.pop_back();
    }
}
 
void PythonParser::processIndentForLine(int column) {
    m_indentAnalyzer.processLine(column);
 
    while (!m_fnStack.empty() && column <= m_fnStack.back().headerColumn) {
        m_fnStack.back().info.endLine = m_lastCodeLine;
        m_result.functions.push_back(m_fnStack.back().info);
        m_fnStack.pop_back();
    }
}
 
void PythonParser::handleKeyword(std::size_t idx) {
    const Token& tok = m_tokens[idx];
    const std::string& v = tok.value;
 
    if (v == "if" || v == "elif") {
        ++m_result.conditionCount;
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "for" || v == "while") {
        ++m_result.loopCount;
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "and" || v == "or") {
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "except") {
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "try") {
        ++m_result.tryCatchCount;
 
    } else if (v == "match") {
        ++m_result.conditionCount;
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "case") {
        ++m_result.cyclomaticComplexity;
 
    } else if (v == "def") {
        tryBeginFunction(idx);
 
    } else if (v == "class") {
        tryRecordClass(idx);
 
    } else if (v == "import" || v == "from") {
        if (m_atStatementStart) {
            ++m_result.includeCount;
            m_result.includeTargets.push_back(extractImportTarget(idx));
        }
    }
}
 
void PythonParser::tryBeginFunction(std::size_t defIdx) {
    const Token& defTok = m_tokens[defIdx];
 
    const std::size_t nameIdx = defIdx + 1;
    if (nameIdx >= m_tokens.size() || m_tokens[nameIdx].type != TokenType::IDENTIFIER)
        return;
 
    const std::size_t openParenIdx = nameIdx + 1;
    if (openParenIdx >= m_tokens.size() ||
        m_tokens[openParenIdx].type != TokenType::OPEN_PAREN)
        return;
 
    const std::size_t closeParenIdx = findMatchingParen(openParenIdx);
    if (closeParenIdx >= m_tokens.size()) return;
 
    std::size_t i = closeParenIdx + 1;
    while (i < m_tokens.size() &&
           !(m_tokens[i].type == TokenType::OPERATOR && m_tokens[i].value == ":") &&
           m_tokens[i].type != TokenType::NEWLINE) {
        ++i;
    }
    if (i >= m_tokens.size() ||
        m_tokens[i].type != TokenType::OPERATOR || m_tokens[i].value != ":")
        return;
 
    PendingFunction pf;
    pf.info.name      = m_tokens[nameIdx].value;
    pf.info.startLine = defTok.line;
    pf.headerColumn   = defTok.col;
    m_fnStack.push_back(std::move(pf));
}
 
void PythonParser::tryRecordClass(std::size_t classIdx) {
    const std::size_t nameIdx = classIdx + 1;
    if (nameIdx < m_tokens.size() && m_tokens[nameIdx].type == TokenType::IDENTIFIER) {
        ClassInfo ci;
        ci.name = m_tokens[nameIdx].value;
        ci.line = m_tokens[classIdx].line;
        ci.kind = ClassInfo::Kind::CLASS;
        m_result.classes.push_back(ci);
    }
}
 
void PythonParser::handleAssignment(std::size_t identIdx) {
    if (m_bracketDepth != 0) return;
 
    if (identIdx > 0) {
        const Token& prev = m_tokens[identIdx - 1];
        if (prev.type == TokenType::OPERATOR &&
            (prev.value == "." || prev.value == ":")) {
            return;
        }
    }
 
    const std::size_t next = identIdx + 1;
    if (next >= m_tokens.size()) return;
 
    const Token& nt = m_tokens[next];
    const bool isSimpleAssign = (nt.type == TokenType::OPERATOR && nt.value == "=");
    const bool isAnnotated    = m_atStatementStart &&
                                 nt.type == TokenType::OPERATOR && nt.value == ":";
    if (!isSimpleAssign && !isAnnotated) return;
 
    ++m_result.variableCount;
}
 
std::string PythonParser::extractImportTarget(std::size_t kwIdx) const {
    std::size_t i = kwIdx + 1;
    std::string target;
    while (i < m_tokens.size()) {
        const Token& t = m_tokens[i];
        if (t.type == TokenType::IDENTIFIER) {
            target += t.value;
        } else if (t.type == TokenType::OPERATOR && t.value == ".") {
            target += t.value;
        } else {
            break;
        }
        ++i;
    }
    return target;
}
 
std::size_t PythonParser::findMatchingParen(std::size_t openIdx) const {
    if (openIdx >= m_tokens.size() || m_tokens[openIdx].type != TokenType::OPEN_PAREN)
        return m_tokens.size();
 
    int depth = 1;
    for (std::size_t i = openIdx + 1; i < m_tokens.size(); ++i) {
        if (m_tokens[i].type == TokenType::OPEN_PAREN)  ++depth;
        if (m_tokens[i].type == TokenType::CLOSE_PAREN) { if (--depth == 0) return i; }
        if (m_tokens[i].type == TokenType::END_OF_FILE) break;
    }
    return m_tokens.size();
}
 
int PythonParser::countTodos(const std::string& text) const {
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
 
