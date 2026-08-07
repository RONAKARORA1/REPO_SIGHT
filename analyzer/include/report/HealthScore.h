#pragma once
 
#include "metrics/Metrics.h"
 
namespace cma {
 
struct HealthScore {
    double score = 0.0;
    char   grade = 'F';
};
 
[[nodiscard]] HealthScore computeHealthScore(const ProjectMetrics& metrics) noexcept;
 
} // namespace cma
 
