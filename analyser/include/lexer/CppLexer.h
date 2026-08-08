#pragma once
 
#include "LexerUtils.h"
#include "Token.h"
 
#include <string>
#include <vector>
 
namespace cma {
 
class CppLexer {
public:
    explicit CppLexer(const std::string& source);
    [[nodiscard]] std::vector<Token> tokenize();
 
private:
    Token lexIdentifierOrKeyword();
    Token lexNumber();
    Token lexString();
    Token lexCharLiteral();
    Token lexLineComment();
    Token lexBlockComment();
    Token lexPreprocessor();
    Token lexSymbol();
 
    char cur()                  const noexcept { return m_stream.cur(); }
    char peekAt(int offset = 1) const noexcept { return m_stream.peekAt(offset); }
    char advance()              noexcept       { return m_stream.advance(); }
    bool atEnd()                const noexcept { return m_stream.atEnd(); }
 
    [[nodiscard]] bool isKeyword(const std::string& word) const noexcept;
 
    CharStream m_stream;
};
 
} // namespace cma
 
