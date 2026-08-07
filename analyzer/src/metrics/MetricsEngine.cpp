#include "metrics/MetricsEngine.h"
 
#include <algorithm>
#include <filesystem>
#include <set>
#include <unordered_map>
 
namespace cma {
 
namespace {
 
bool pathEndsWithComponent(const std::string& path, const std::string& candidate) {
    if (candidate.empty() || candidate.size() > path.size()) return false;
    if (path.compare(path.size() - candidate.size(), candidate.size(), candidate) != 0)
        return false;
    const auto boundaryIdx = path.size() - candidate.size();
    if (boundaryIdx == 0) return true;
    const char before = path[boundaryIdx - 1];
    return before == '/' || before == '\\';
}
 
std::vector<std::string> candidateSuffixes(const std::string& target) {
    std::vector<std::string> candidates;
    if (target.empty() || target.back() == '*') return candidates;
 
    candidates.push_back(target);
 
    const auto dotPos = target.find('.');
    if (dotPos != std::string::npos) {
        std::string asPath = target;
        for (auto& c : asPath) if (c == '.') c = '/';
        candidates.push_back(asPath + ".py");
        candidates.push_back(asPath + ".java");
 
        const auto lastDot = target.find_last_of('.');
        const std::string basename = target.substr(lastDot + 1);
        if (!basename.empty()) {
            candidates.push_back(basename + ".py");
            candidates.push_back(basename + ".java");
        }
    }
    return candidates;
}
 
} // anonymous namespace
 
void MetricsEngine::addFile(const std::string& filename, FileMetrics metrics) {
    m_files.emplace_back(filename, std::move(metrics));
}
 
const std::vector<std::pair<std::string, FileMetrics>>&
MetricsEngine::files() const noexcept {
    return m_files;
}
 
ProjectMetrics MetricsEngine::compute() const {
    ProjectMetrics pm;
    pm.filesAnalyzed = static_cast<int>(m_files.size());
 
    long totalFnLength = 0;
    int  totalFnCount  = 0;
 
    for (const auto& [filename, fm] : m_files) {
        pm.totalLines        += fm.totalLines;
        pm.blankLines        += fm.blankLines;
        pm.commentLines      += fm.commentLines;
        pm.codeLines         += fm.codeLines;
        pm.functionCount     += fm.functionCount();
        pm.classCount        += fm.classCount();
        pm.variableCount     += fm.variableCount;
        pm.includeCount      += fm.includeCount;
        pm.loopCount         += fm.loopCount;
        pm.conditionCount    += fm.conditionCount;
        pm.tryCatchCount     += fm.tryCatchCount;
        pm.cyclomaticComplexity += fm.cyclomaticComplexity;
        pm.todoCount         += fm.todoCount;
        pm.maxNestingDepth    = std::max(pm.maxNestingDepth, fm.maxNestingDepth);
 
        for (const auto& fn : fm.functions) {
            totalFnLength += fn.lineCount();
            ++totalFnCount;
            if (fn.lineCount() > pm.longestFunctionLines) {
                pm.longestFunctionLines = fn.lineCount();
                pm.longestFunctionName  = fn.name + "()";
            }
        }
    }
 
    pm.avgFunctionLength = (totalFnCount > 0)
        ? static_cast<double>(totalFnLength) / totalFnCount
        : 0.0;
 
    return pm;
}
 
DependencyGraph MetricsEngine::buildDependencyGraph() const {
    DependencyGraph graph;
    graph.files.reserve(m_files.size());
    for (const auto& [path, fm] : m_files) {
        FileCoupling fc;
        fc.path = path;
        graph.files.push_back(std::move(fc));
    }
    std::sort(graph.files.begin(), graph.files.end(),
              [](const FileCoupling& a, const FileCoupling& b) { return a.path < b.path; });
 
    std::unordered_map<std::string, std::size_t> indexByPath;
    indexByPath.reserve(graph.files.size());
    for (std::size_t i = 0; i < graph.files.size(); ++i) indexByPath[graph.files[i].path] = i;
 
    std::vector<std::set<std::string>> dependsOnSets(graph.files.size());
    std::vector<std::set<std::string>> dependedOnBySets(graph.files.size());
 
    for (const auto& [srcPath, fm] : m_files) {
        const auto srcIdxIt = indexByPath.find(srcPath);
        if (srcIdxIt == indexByPath.end()) continue;
        const std::size_t srcIdx = srcIdxIt->second;
 
        for (const auto& target : fm.includeTargets) {
            bool resolved = false;
            for (const auto& candidate : candidateSuffixes(target)) {
                for (std::size_t j = 0; j < graph.files.size(); ++j) {
                    if (j == srcIdx) continue;
                    if (pathEndsWithComponent(graph.files[j].path, candidate)) {
                        dependsOnSets[srcIdx].insert(graph.files[j].path);
                        dependedOnBySets[j].insert(srcPath);
                        resolved = true;
                        break;
                    }
                }
                if (resolved) break;
            }
        }
    }
 
    for (std::size_t i = 0; i < graph.files.size(); ++i) {
        graph.files[i].dependsOn.assign(dependsOnSets[i].begin(), dependsOnSets[i].end());
        graph.files[i].dependedOnBy.assign(dependedOnBySets[i].begin(), dependedOnBySets[i].end());
        graph.files[i].fanOut = static_cast<int>(graph.files[i].dependsOn.size());
        graph.files[i].fanIn  = static_cast<int>(graph.files[i].dependedOnBy.size());
    }
 
    return graph;
}
 
HotspotReport MetricsEngine::buildHotspotReport(const GitHistory& git) const {
    HotspotReport report;
    if (!git.available()) {
        report.gitAvailable = false;
        return report;
    }
    report.gitAvailable = true;
 
    const auto& churnMap = git.churn();
 
    int maxComplexity = 0;
    int maxCommits     = 0;
 
    std::vector<FileHotspot> hotspots;
    hotspots.reserve(m_files.size());
 
    for (const auto& [path, fm] : m_files) {
        FileHotspot fh;
        fh.path = path;
        fh.cyclomaticComplexity = fm.cyclomaticComplexity;
 
        const auto key = canonicalPathKey(std::filesystem::path(path));
        const auto it  = churnMap.find(key);
        if (it != churnMap.end()) {
            fh.commitCount  = it->second.commitCount;
            fh.linesAdded   = it->second.linesAdded;
            fh.linesDeleted = it->second.linesDeleted;
        }
 
        maxComplexity = std::max(maxComplexity, fh.cyclomaticComplexity);
        maxCommits    = std::max(maxCommits, fh.commitCount);
 
        hotspots.push_back(std::move(fh));
    }
 
    for (auto& fh : hotspots) {
        const double normComplexity =
            (maxComplexity > 0) ? static_cast<double>(fh.cyclomaticComplexity) / maxComplexity : 0.0;
        const double normChurn =
            (maxCommits > 0) ? static_cast<double>(fh.commitCount) / maxCommits : 0.0;
        fh.hotspotScore = normComplexity * normChurn * 100.0;
    }
 
    std::sort(hotspots.begin(), hotspots.end(), [](const FileHotspot& a, const FileHotspot& b) {
        if (a.hotspotScore != b.hotspotScore) return a.hotspotScore > b.hotspotScore;
        return a.path < b.path;
    });
 
    report.files = std::move(hotspots);
    return report;
}
 
} // namespace cma
 
