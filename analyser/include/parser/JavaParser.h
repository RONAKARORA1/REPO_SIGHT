#pragma once
 
#include "BraceBlockAnalyzer.h"
#include "ParseResult.h"
#include "lexer/Token.h"
 
#include <string>
#include <vector>
 
namespace cma {
 
class JavaParser {
public:
    explicit JavaParser(const std::vector<Token>& tokens, int totalLines);
 
    [[nodiscard]] FileMetrics analyze();
 
private:
    struct PendingFunction {
        FunctionInfo info;
        int          bodyBraceDepth = 0;
    };
 
    void classifyLines();
 
    void walkTokens();
    void handleKeyword(std::size_t idx);
    void tryBeginFunction(std::size_t identIdx);
    void handleVariableDecl(std::size_t identIdx);
    void tryRecordClass(std::size_t kwIdx, const std::string& kwValue);
 
    [[nodiscard]] std::string extractImportTarget(std::size_t kwIdx) const;
 
    [[nodiscard]] std::size_t findMatchingParen(std::size_t openIdx) const;
    [[nodiscard]] std::size_t skipTrailingSpecifiers(std::size_t afterCloseParen) const;
 
    [[nodiscard]] int countTodos(const std::string& commentText) const;
 
    const std::vector<Token>& m_tokens;
    int                        m_totalLines;
    FileMetrics                m_result;
 
    BraceBlockAnalyzer            m_braceAnalyzer;
    std::vector<PendingFunction>  m_fnStack;
 
    enum class LineType { BLANK, COMMENT, CODE };
    std::vector<LineType> m_lineTypes;
};
 
} // namespace cma
 
