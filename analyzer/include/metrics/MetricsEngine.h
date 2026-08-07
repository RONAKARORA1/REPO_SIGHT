#pragma once
 
#include "Metrics.h"
#include "DependencyGraph.h"
#include "HotspotReport.h"
#include "parser/ParseResult.h"
#include "vcs/GitHistory.h"
 
#include <string>
#include <utility>
#include <vector>
 
namespace cma {
 
class MetricsEngine {
public:
    void addFile(const std::string& filename, FileMetrics metrics);
 
    [[nodiscard]] ProjectMetrics compute() const;
 
    [[nodiscard]] const std::vector<std::pair<std::string, FileMetrics>>&
    files() const noexcept;
 
    [[nodiscard]] DependencyGraph buildDependencyGraph() const;
 
    [[nodiscard]] HotspotReport buildHotspotReport(const GitHistory& git) const;
 
private:
    std::vector<std::pair<std::string, FileMetrics>> m_files;
};
 
} // namespace cma
 
