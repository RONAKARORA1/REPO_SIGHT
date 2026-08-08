#pragma once
 
#include <algorithm>
#include <vector>
 
namespace cma {
 
class IndentBlockAnalyzer {
public:
    int processLine(int column) noexcept {
        while (!m_columns.empty() && column < m_columns.back()) {
            m_columns.pop_back();
        }
        const int top = m_columns.empty() ? kBaseColumn : m_columns.back();
        if (column > top) {
            m_columns.push_back(column);
        }
        const int d = depth();
        m_maxDepth = std::max(m_maxDepth, d);
        return d;
    }
 
    [[nodiscard]] int depth() const noexcept {
        return static_cast<int>(m_columns.size());
    }
    [[nodiscard]] int maxDepth() const noexcept { return m_maxDepth; }
 
private:
    static constexpr int kBaseColumn = 1;
    std::vector<int> m_columns;
    int m_maxDepth = 0;
};
 
} // namespace cma
 
