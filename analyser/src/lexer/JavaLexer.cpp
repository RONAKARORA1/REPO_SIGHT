#include "lexer/JavaLexer.h"
 
#include <cctype>
#include <unordered_set>
 
namespace cma {
 
static const std::unordered_set<std::string> kKeywords = {
    "abstract","assert","boolean","break","byte",
    "case","catch","char","class","const","continue",
    "default","do","double",
    "else","enum","extends",
    "final","finally","float","for",
    "goto",
    "if","implements","import","instanceof","int","interface",
    "long",
    "native","new",
    "package","private","protected","public",
    "return",
    "short","static","strictfp","super","switch","synchronized",
    "this","throw","throws","transient","try",
    "void","volatile",
    "while",
    "true","false","null",
    "var","record","yield","sealed","permits"
};
 
JavaLexer::JavaLexer(const std::string& source) : m_stream(source) {}
 
bool JavaLexer::isIdentStart(char c) noexcept {
    return std::isalpha(static_cast<unsigned char>(c)) || c == '_' || c == '$';
}
 
bool JavaLexer::isIdentChar(char c) noexcept {
    return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '$';
}
 
std::vector<Token> JavaLexer::tokenize() {
    std::vector<Token> tokens;
    tokens.reserve(m_stream.size() / 4);
 
    while (!atEnd()) {
        const char c = cur();
 
        if (c == '\n') {
            tokens.push_back({TokenType::NEWLINE, "\n", m_stream.line(), m_stream.col()});
            advance();
            continue;
        }
        if (std::isspace(static_cast<unsigned char>(c))) {
            advance();
            continue;
        }
        if (c == '/' && peekAt() == '/') { tokens.push_back(lexLineComment());  continue; }
        if (c == '/' && peekAt() == '*') { tokens.push_back(lexBlockComment()); continue; }
        if (c == '"')  { tokens.push_back(lexString());      continue; }
        if (c == '\'') { tokens.push_back(lexCharLiteral());  continue; }
        if (std::isdigit(static_cast<unsigned char>(c))) { tokens.push_back(lexNumber()); continue; }
        if (isIdentStart(c)) { tokens.push_back(lexIdentifierOrKeyword()); continue; }
 
        tokens.push_back(lexSymbol());
    }
 
    tokens.push_back({TokenType::END_OF_FILE, "", m_stream.line(), m_stream.col()});
    return tokens;
}
 
Token JavaLexer::lexIdentifierOrKeyword() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && isIdentChar(cur())) value += advance();
    const TokenType type = isKeyword(value) ? TokenType::KEYWORD : TokenType::IDENTIFIER;
    return {type, std::move(value), sl, sc};
}
 
Token JavaLexer::lexNumber() {
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
 
Token JavaLexer::lexString() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    const bool triple = (cur() == '"' && peekAt(1) == '"' && peekAt(2) == '"');
 
    if (triple) {
        value += advance(); value += advance(); value += advance();
        while (!atEnd()) {
            if (cur() == '"' && peekAt(1) == '"' && peekAt(2) == '"') {
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
        while (!atEnd() && cur() != '"') {
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
 
Token JavaLexer::lexCharLiteral() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance();
    while (!atEnd() && cur() != '\'') {
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
    return {TokenType::CHAR_LITERAL, std::move(value), sl, sc};
}
 
Token JavaLexer::lexLineComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    while (!atEnd() && cur() != '\n') value += advance();
    return {TokenType::LINE_COMMENT, std::move(value), sl, sc};
}
 
Token JavaLexer::lexBlockComment() {
    const int sl = m_stream.line(), sc = m_stream.col();
    std::string value;
    value += advance(); value += advance();
    while (!atEnd()) {
        if (cur() == '*' && peekAt() == '/') {
            value += advance(); value += advance();
            break;
        }
        value += advance();
    }
    return {TokenType::BLOCK_COMMENT, std::move(value), sl, sc};
}
 
Token JavaLexer::lexSymbol() {
    const int sl = m_stream.line(), sc = m_stream.col();
    const char c = advance();
    const std::string val(1, c);
 
    switch (c) {
        case '{': return {TokenType::OPEN_BRACE,    val, sl, sc};
        case '}': return {TokenType::CLOSE_BRACE,   val, sl, sc};
        case '(': return {TokenType::OPEN_PAREN,    val, sl, sc};
        case ')': return {TokenType::CLOSE_PAREN,   val, sl, sc};
        case '[': return {TokenType::OPEN_BRACKET,  val, sl, sc};
        case ']': return {TokenType::CLOSE_BRACKET, val, sl, sc};
        case ';': return {TokenType::SEMICOLON,     val, sl, sc};
        case '+': case '-': case '*': case '/': case '%':
        case '=': case '<': case '>': case '!':
        case '&': case '|': case '^': case '~':
        case '?': case ':': case '.':
            return {TokenType::OPERATOR, val, sl, sc};
        default:
            return {TokenType::PUNCTUATION, val, sl, sc};
    }
}
 
bool JavaLexer::isKeyword(const std::string& word) const noexcept {
    return kKeywords.count(word) != 0;
}
 
} // namespace cma
 
