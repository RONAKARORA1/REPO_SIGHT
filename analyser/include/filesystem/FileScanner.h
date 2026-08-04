#pragma once
 
#include <filesystem>
#include <optional>
#include <string>
#include <vector>
 
namespace cma {
 
// Discovers analyzable source files within a directory tree and reads
// file content.
//
// Single responsibility: file I/O and extension-based discovery only.
// This class does not tokenize, parse, or analyze, and — deliberately —
// does not know which *language* a file is, only whether some front-end
// recognizes its extension. Language identity is a separate concern
// (see common/Language.h's detectLanguage()), kept out of this class so
// FileScanner's contract doesn't grow with every new language front-end.
//
// Usage:
//   FileScanner scanner("/path/to/project");
//   for (const auto& path : scanner.scan()) {
//       auto content = FileScanner::readFile(path);
//       if (content) { /* pass to the language front-end for path */ }
//   }
class FileScanner {
public:
    // rootPath may be a directory (scanned recursively) or a single file.
    // Takes by value and moves: no copy of the path string on construction.
    explicit FileScanner(std::filesystem::path rootPath);
 
    // Walks the directory tree and returns all recognized source file
    // paths (C++, Python, and Java, as of Phase 3).
    // - Sorts results for deterministic output across platforms.
    // - Silently skips permission-denied entries.
    // - Returns an empty vector (never throws) if rootPath is invalid.
    [[nodiscard]] std::vector<std::filesystem::path> scan() const;
 
    // Reads the entire content of filePath into a std::string.
    // Returns std::nullopt if the file cannot be opened or an I/O error occurs.
    // static: requires no instance state — pure path → content transformation.
    [[nodiscard]] static std::optional<std::string> readFile(
        const std::filesystem::path& filePath);
 
private:
    std::filesystem::path m_rootPath;
 
    // Returns true if path has an extension recognized by any language
    // front-end (see the kSupportedExtensions set in FileScanner.cpp).
    [[nodiscard]] static bool isSupportedFile(const std::filesystem::path& path);
};
 
} // namespace cma
 
