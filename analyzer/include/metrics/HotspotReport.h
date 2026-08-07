#pragma once
 
#include <string>
#include <vector>
 
namespace cma {
 
struct FileHotspot {
    std::string path;
    int    cyclomaticComplexity = 0;
    int    commitCount           = 0;
    int    linesAdded            = 0;
    int    linesDeleted          = 0;
    double hotspotScore          = 0.0;
};
 
struct HotspotReport {
    std::vector<FileHotspot> files;
    bool gitAvailable = false;
};
 
} // namespace cma
 
