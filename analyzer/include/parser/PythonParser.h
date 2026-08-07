#pragma once
 
#include "IndentBlockAnalyzer.h"
#include "ParseResult.h"
#include "lexer/Token.h"
 
#include <vector>
 
namespace cma {
 
class PythonParser {
public:
    explicit PythonParser(const std::vector<Token>& tokens, int totalLines);
 
    [[nodiscard]] FileMetrics analyze();
 
private:
    struct PendingFunction {
        FunctionInfo info;
        int          headerColumn = 0;
    };
 
    void classifyLines();
 
    void walkTokens();
    void handleKeyword(std::size_t idx);
    void handleAssignment(std::size_t identIdx);
    void tryBeginFunction(std::size_t defIdx);
    void tryRecordClass(std::size_t classIdx);
 
    [[nodiscard]] std::string extractImportTarget(std::size_t kwIdx) const;
 
    void processIndentForLine(int column);
 
    [[nodiscard]] std::size_t findMatchingParen(std::size_t openIdx) const;
 
    [[nodiscard]] int countTodos(const std::string& commentText) const;
 
    const std::vector<Token>& m_tokens;
    int                        m_totalLines;
    FileMetrics                m_result;
 
    IndentBlockAnalyzer          m_indentAnalyzer;
    std::vector<PendingFunction> m_fnStack;
 
    int  m_bracketDepth     = 0;
    bool m_atStatementStart = true;
    int  m_lastCodeLine     = 0;
    int  m_lastIndentLine   = 0;
 
    enum class LineType { BLANK, COMMENT, CODE };
    std::vector<LineType> m_lineTypes;
};
 
} // namespace cma
 
