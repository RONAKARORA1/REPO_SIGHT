#include "lexer/PythonLexer.h"
 
#include <array>
#include <cctype>
#include <unordered_set>
 
namespace cma {
 
static const std::unordered_set<std::string> kKeywords = {
    "False","None","True",
    "and","as","assert","async","await",
    "break",
    "class","continue",
    "def","del",
    "elif","else","except",
    "finally","for","from",
    "global",
    "if","import","in","is",
    "lambda",
    "nonlocal","not",
    "or",
    "pass",
    "raise","return",
    "try",
    "while","with",
    "yield",
    "match","case"
};
 
static const std::array<const char*, 18> kTwoCharOps = {
    "**", "//", "==", "!=", "<=", ">=", "->", ":=",
    "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", ">>", "<<"
};
 
PythonLexer::PythonLexer(const std::string& source)
    : m_stream(source) {}
 
std::vector<Token> PythonLexer::tokenize() {
    std::vector<Token> tokens;
    tokens.reserve(m_stream.size() / 4);
 
    while (!atEnd()) {
        const char c = cur();
 
        if (c == '\\' && peekAt() == '\n') {
            advance();
            advance();
            continue;
        }
 
        if (c == '\n') {
            if (m_bracketDepth > 0) {
                advance();
                continue;
            }
            tokens.push_back({TokenType::NEWLINE, "\n", m_stream.line(), m_stream.col()});
            advance();
            continue;
        }
 
        if (std::isspace(static_cast<unsigned char>(c))) {
            advance();
            continue;
        }
 
        if (c == '#') { tokens.push_back(lexLineComment()); continue; }
 
        if (c == '"' || c == '\'' || stringPrefixLength() > 0) {
            tokens.push_back(lexString());
            continue;
        }
 
        if (std::isdigit(static_cast<unsigned char>(c))) {
            tokens.push_back(lexNumber());
            continue;
        }
        if (std::isalpha(static_cast<unsigned char>(c)) || c == '_') {
            tokens.push_back(lexIdentifierOrKeyword());
            continue;
        }
 
        tokens.push_back(lexSymbol());
    }
 
    tokens.push_back({TokenType::END_OF_FILE, "", m_stream.line(), m_stream.col()});
    return tokens;
}
 
Token PythonLexer::lexIdentifierOrKeyword() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
 
    while (!atEnd() &&
           (std::isalnum(static_cast<unsigned char>(cur())) || cur() == '_')) {
        value += advance();
    }
 
    const TokenType type =
        isKeyword(value) ? TokenType::KEYWORD : TokenType::IDENTIFIER;
    return {type, std::move(value), sl, sc};
}
 
Token PythonLexer::lexNumber() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
 
    while (!atEnd()) {
        const char c = cur();
        if (std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '_') {
            value += advance();
        } else if ((c == '+' || c == '-') && !value.empty() &&
                   (value.back() == 'e' || value.back() == 'E')) {
            value += advance();
        } else {
            break;
        }
    }
    return {TokenType::NUMBER_LITERAL, std::move(value), sl, sc};
}
 
int PythonLexer::stringPrefixLength() const noexcept {
    auto isQuote = [](char c) { return c == '\'' || c == '"'; };
    auto isPrefixChar = [](char c) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        return c == 'r' || c == 'b' || c == 'u' || c == 'f';
    };
    if (isQuote(cur())) return 0;
    if (!isPrefixChar(cur())) return 0;
    if (isQuote(peekAt(1))) return 1;
    if (isPrefixChar(peekAt(1)) && isQuote(peekAt(2))) return 2;
    return 0;
}
 
Token PythonLexer::lexString() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
 
    const int plen = stringPrefixLength();
    for (int i = 0; i < plen; ++i) value += advance();
 
    const char quote = cur();
    const bool triple = (peekAt(1) == quote && peekAt(2) == quote);
 
    if (triple) {
        value += advance(); value += advance(); value += advance();
        while (!atEnd()) {
            if (cur() == quote && peekAt(1) == quote && peekAt(2) == quote) {
                value += advance(); value += advance(); value += advance();
                break;
            }
            if (cur() == '\\') {
                value += advance();
                if (!atEnd()) value += advance();
            } else {
                value += advance();
            }
        }
    } else {
        value += advance();
        while (!atEnd() && cur() != quote) {
            if (cur() == '\\') {
                value += advance();
                if (!atEnd()) value += advance();
            } else if (cur() == '\n') {
                break;
            } else {
                value += advance();
            }
        }
        if (!atEnd()) value += advance();
    }
    return {TokenType::STRING_LITERAL, std::move(value), sl, sc};
}
 
Token PythonLexer::lexLineComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && cur() != '\n') value += advance();
    return {TokenType::LINE_COMMENT, std::move(value), sl, sc};
}
 
Token PythonLexer::lexSymbol() {
    const int sl = m_stream.line(), sc = m_stream.col();
 
    for (const char* op : kTwoCharOps) {
        if (cur() == op[0] && peekAt(1) == op[1]) {
            advance();
            advance();
            return {TokenType::OPERATOR, std::string(op), sl, sc};
        }
    }
 
    const char c = advance();
    const std::string val(1, c);
 
    switch (c) {
        case '(': ++m_bracketDepth;
                  return {TokenType::OPEN_PAREN,    val, sl, sc};
        case ')': if (m_bracketDepth > 0) --m_bracketDepth;
                  return {TokenType::CLOSE_PAREN,   val, sl, sc};
        case '[': ++m_bracketDepth;
                  return {TokenType::OPEN_BRACKET,  val, sl, sc};
        case ']': if (m_bracketDepth > 0) --m_bracketDepth;
                  return {TokenType::CLOSE_BRACKET, val, sl, sc};
        case '{': ++m_bracketDepth;
                  return {TokenType::OPEN_BRACE,    val, sl, sc};
        case '}': if (m_bracketDepth > 0) --m_bracketDepth;
                  return {TokenType::CLOSE_BRACE,   val, sl, sc};
        case ';': return {TokenType::SEMICOLON, val, sl, sc};
        case '+': case '-': case '*': case '/': case '%':
        case '=': case '<': case '>': case '!':
        case '&': case '|': case '^': case '~':
        case '@': case ':': case '.':
            return {TokenType::OPERATOR, val, sl, sc};
        default:
            return {TokenType::PUNCTUATION, val, sl, sc};
    }
}
 
bool PythonLexer::isKeyword(const std::string& word) const noexcept {
    return kKeywords.count(word) != 0;
}
 
} // namespace cma
 
