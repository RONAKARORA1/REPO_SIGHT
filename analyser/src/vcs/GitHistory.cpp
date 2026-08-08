#include "vcs/GitHistory.h"
 
#include <array>
#include <cstdio>
#include <sstream>
 
namespace cma {
 
namespace {
 
struct CommandResult {
    bool        ok = false;
    std::string output;
};
 
CommandResult runCommand(const std::string& cmd) {
    CommandResult result;
    std::array<char, 4096> buf{};
 
    FILE* pipe = popen(cmd.c_str(), "r");
    if (pipe == nullptr) return result;
 
    std::ostringstream captured;
    while (std::fgets(buf.data(), static_cast<int>(buf.size()), pipe) != nullptr) {
        captured << buf.data();
    }
 
    const int status = pclose(pipe);
    result.ok     = (status == 0);
    result.output = captured.str();
    return result;
}
 
std::string trimTrailingNewline(std::string s) {
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r')) s.pop_back();
    return s;
}
 
std::string resolveRenameTarget(const std::string& rawPath) {
    const auto braceOpen  = rawPath.find('{');
    const auto braceClose = rawPath.find('}');
    if (braceOpen != std::string::npos && braceClose != std::string::npos &&
        braceClose > braceOpen) {
        const std::string prefix = rawPath.substr(0, braceOpen);
        const std::string inner  = rawPath.substr(braceOpen + 1, braceClose - braceOpen - 1);
        const std::string suffix = rawPath.substr(braceClose + 1);
        const auto arrow = inner.find(" => ");
        if (arrow != std::string::npos) {
            const std::string newInner = inner.substr(arrow + 4);
            return prefix + newInner + suffix;
        }
        return rawPath;
    }
 
    const auto arrow = rawPath.find(" => ");
    if (arrow != std::string::npos) {
        return rawPath.substr(arrow + 4);
    }
 
    return rawPath;
}
 
std::string stripSurroundingQuotes(const std::string& s) {
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') {
        return s.substr(1, s.size() - 2);
    }
    return s;
}
 
} // anonymous namespace
 
std::unordered_map<std::string, FileChurn> parseGitLogOutput(const std::string& rawOutput) {
    std::unordered_map<std::string, FileChurn> churn;
 
    std::istringstream stream(rawOutput);
    std::string line;
    while (std::getline(stream, line)) {
        if (line.empty()) continue;
        if (line == "__CMA_COMMIT__") continue;
 
        const auto firstTab = line.find('\t');
        if (firstTab == std::string::npos) continue;
        const auto secondTab = line.find('\t', firstTab + 1);
        if (secondTab == std::string::npos) continue;
 
        const std::string addedStr   = line.substr(0, firstTab);
        const std::string deletedStr = line.substr(firstTab + 1, secondTab - firstTab - 1);
        std::string       pathField  = line.substr(secondTab + 1);
 
        int added = 0, deleted = 0;
        if (addedStr != "-") {
            try { added = std::stoi(addedStr); } catch (...) { continue; }
        }
        if (deletedStr != "-") {
            try { deleted = std::stoi(deletedStr); } catch (...) { continue; }
        }
 
        const std::string path = stripSurroundingQuotes(resolveRenameTarget(pathField));
        if (path.empty()) continue;
 
        auto& fc = churn[path];
        ++fc.commitCount;
        fc.linesAdded   += added;
        fc.linesDeleted += deleted;
    }
 
    return churn;
}
 
std::string canonicalPathKey(const std::filesystem::path& p) {
    std::error_code ec;
    auto canon = std::filesystem::canonical(p, ec);
    if (ec) {
        return std::filesystem::absolute(p).lexically_normal().generic_string();
    }
    return canon.generic_string();
}
 
GitHistory::GitHistory(std::filesystem::path repoRoot)
    : m_repoRoot(std::move(repoRoot)) {}
 
bool GitHistory::collect() {
    m_churn.clear();
    m_available = false;
 
    const std::string rootArg = m_repoRoot.string();
 
    const auto toplevelResult = runCommand(
        "git -C \"" + rootArg + "\" rev-parse --show-toplevel 2>/dev/null");
    if (!toplevelResult.ok) return false;
 
    const std::string toplevel = trimTrailingNewline(toplevelResult.output);
    if (toplevel.empty()) return false;
 
    const auto logResult = runCommand(
        "git -C \"" + toplevel + "\" log --pretty=format:\"__CMA_COMMIT__\" --numstat 2>/dev/null");
    if (!logResult.ok || logResult.output.empty()) return false;
 
    const auto rawChurn = parseGitLogOutput(logResult.output);
    if (rawChurn.empty()) return false;
 
    const std::filesystem::path toplevelPath(toplevel);
    for (const auto& [relPath, fc] : rawChurn) {
        const auto absPath = toplevelPath / relPath;
        m_churn[canonicalPathKey(absPath)] = fc;
    }
 
    m_available = true;
    return true;
}
 
const std::unordered_map<std::string, FileChurn>& GitHistory::churn() const noexcept {
    return m_churn;
}
 
} // namespace cma
 
