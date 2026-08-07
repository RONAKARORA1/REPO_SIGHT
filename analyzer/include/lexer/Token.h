#pragma once
 
#include <string>
 
namespace cma {
 
enum class TokenType {
    KEYWORD,
    IDENTIFIER,
    STRING_LITERAL,
    CHAR_LITERAL,
    NUMBER_LITERAL,
    OPEN_BRACE,
    CLOSE_BRACE,
    OPEN_PAREN,
    CLOSE_PAREN,
    OPEN_BRACKET,
    CLOSE_BRACKET,
    SEMICOLON,
    LINE_COMMENT,
    BLOCK_COMMENT,
    PREPROCESSOR,
    OPERATOR,
    PUNCTUATION,
    NEWLINE,
    END_OF_FILE,
    UNKNOWN
};
 
struct Token {
    TokenType   type  = TokenType::UNKNOWN;
    std::string value;
    int         line  = 0;
    int         col   = 0;
};
 
inline bool isLoopKeyword(const Token& t) noexcept {
    return t.type == TokenType::KEYWORD &&
           (t.value == "for" || t.value == "while" || t.value == "do");
}
 
inline bool isCondKeyword(const Token& t) noexcept {
    return t.type == TokenType::KEYWORD &&
           (t.value == "if" || t.value == "switch");
}
 
inline bool isClassLike(const Token& t) noexcept {
    return t.type == TokenType::KEYWORD &&
           (t.value == "class"     || t.value == "struct" ||
            t.value == "enum"      || t.value == "namespace");
}
 
inline bool isExceptionKw(const Token& t) noexcept {
    return t.type == TokenType::KEYWORD &&
           (t.value == "try" || t.value == "catch");
}
 
} // namespace cma
