#pragma once
 
#include <algorithm>
 
namespace cma {
 
class BraceBlockAnalyzer {
public:
    void onOpenBrace() noexcept {
        ++m_depth;
        m_maxDepth = std::max(m_maxDepth, m_depth);
    }
 
    void onCloseBrace() noexcept {
        if (m_depth > 0) --m_depth;
    }
 
    [[nodiscard]] int depth()    const noexcept { return m_depth; }
    [[nodiscard]] int maxDepth() const noexcept { return m_maxDepth; }
 
private:
    int m_depth    = 0;
    int m_maxDepth = 0;
};
 
} // namespace cma
 
