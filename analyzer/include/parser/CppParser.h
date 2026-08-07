#pragma once
 
#include "BraceBlockAnalyzer.h"
#include "ParseResult.h"
#include "lexer/Token.h"
 
#include <vector>
 
namespace cma {
 
class CppParser {
public:
    explicit CppParser(const std::vector<Token>& tokens, int totalLines);
 
    [[nodiscard]] FileMetrics analyze();
 
private:
    void classifyLines();
 
    void walkTokens();
    void handleKeyword(std::size_t idx);
    void tryBeginFunction(std::size_t identIdx);
    void handleVariableDecl(std::size_t identIdx);
 
    [[nodiscard]] std::size_t findMatchingParen(std::size_t openIdx) const;
    [[nodiscard]] std::size_t skipTrailingSpecifiers(std::size_t afterCloseParen) const;
    [[nodiscard]] int countTodos(const std::string& commentText) const;
 
    const std::vector<Token>& m_tokens;
    int                        m_totalLines;
    FileMetrics                m_result;
 
    BraceBlockAnalyzer m_braceAnalyzer;
 
    bool         m_inFunction   = false;
    int          m_fnBraceDepth = 0;
    FunctionInfo m_currentFn;
 
    enum class LineType { BLANK, COMMENT, CODE };
    std::vector<LineType> m_lineTypes;
};
 
} // namespace cma
 
