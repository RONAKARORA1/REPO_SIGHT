#pragma once
 
#include <cstddef>
#include <string>
 
namespace cma {
 
class CharStream {
public:
    explicit CharStream(const std::string& source) noexcept
        : m_src(source) {}
 
    [[nodiscard]] char cur() const noexcept {
        return atEnd() ? '\0' : m_src[m_pos];
    }
 
    [[nodiscard]] char peekAt(int offset = 1) const noexcept {
        const auto idx = static_cast<std::size_t>(
            static_cast<std::ptrdiff_t>(m_pos) + offset);
        return (idx < m_src.size()) ? m_src[idx] : '\0';
    }
 
    char advance() noexcept {
        const char c = m_src[m_pos++];
        if (c == '\n') { ++m_line; m_col = 1; }
        else           { ++m_col; }
        return c;
    }
 
    [[nodiscard]] bool atEnd() const noexcept {
        return m_pos >= m_src.size();
    }
 
    [[nodiscard]] int line() const noexcept { return m_line; }
    [[nodiscard]] int col()  const noexcept { return m_col;  }
 
    [[nodiscard]] std::size_t size() const noexcept { return m_src.size(); }
 
private:
    const std::string& m_src;
    std::size_t         m_pos  = 0;
    int                  m_line = 1;
    int                  m_col  = 1;
};
 
} // namespace cma
 
