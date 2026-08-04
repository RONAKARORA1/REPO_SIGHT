#pragma once
 
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>
 
namespace cma {
 
struct FileChurn {
    int commitCount  = 0;
    int linesAdded   = 0;
    int linesDeleted = 0;
};
 
class GitHistory {
public:
    explicit GitHistory(std::filesystem::path repoRoot);
 
    [[nodiscard]] bool collect();
 
    [[nodiscard]] const std::unordered_map<std::string, FileChurn>& churn() const noexcept;
 
    [[nodiscard]] bool available() const noexcept { return m_available; }
 
private:
    std::filesystem::path m_repoRoot;
    std::unordered_map<std::string, FileChurn> m_churn;
    bool m_available = false;
};
 
[[nodiscard]] std::string canonicalPathKey(const std::filesystem::path& p);
 
[[nodiscard]] std::unordered_map<std::string, FileChurn>
parseGitLogOutput(const std::string& rawOutput);
 
} // namespace cma
 
