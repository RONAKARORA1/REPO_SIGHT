#pragma once
 
#include <string>
#include <vector>
 
namespace cma {
 
struct FileCoupling {
    std::string path;
    int fanOut = 0;
    int fanIn  = 0;
    std::vector<std::string> dependsOn;
    std::vector<std::string> dependedOnBy;
};
 
struct DependencyGraph {
    std::vector<FileCoupling> files;
};
 
} // namespace cma
 
