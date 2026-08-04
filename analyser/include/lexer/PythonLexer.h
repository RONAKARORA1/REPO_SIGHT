#pragma once
 
#include "LexerUtils.h"
#include "Token.h"
 
#include <string>
#include <vector>
 
namespace cma {
 
class PythonLexer {
public:
    explicit PythonLexer(const std::string& source);
    [[nodiscard]] std::vector<Token> tokenize();
 
private:
    Token lexIdentifierOrKeyword();
    Token lexNumber();
    Token lexString();
    Token lexLineComment();
    Token lexSymbol();
 
    [[nodiscard]] int stringPrefixLength() const noexcept;
 
    char cur()                  const noexcept { return m_stream.cur(); }
    char peekAt(int offset = 1) const noexcept { return m_stream.peekAt(offset); }
    char advance()               noexcept      { return m_stream.advance(); }
    bool atEnd()                const noexcept { return m_stream.atEnd(); }
 
    [[nodiscard]] bool isKeyword(const std::string& word) const noexcept;
 
    CharStream m_stream;
    int m_bracketDepth = 0;
};
 
} // namespace cma
 
