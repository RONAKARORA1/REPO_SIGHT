#pragma once
 
#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"
 
#include <string>
#include <vector>
 
namespace cma {
 
// C++ anti-pattern / best-practice rule catalog -- Phase 4 Sprint 3B (7
// rules). Operates purely on the token stream CppLexer already produced
// and the FileMetrics CppParser already computed -- never touches
// CppParser internals, never re-lexes.
//
// RECONSTRUCTED FILE -- never uploaded to project knowledge as literal
// source, only described in prose (rule table + design notes). Rebuilt
// from that spec; the 21-case-table-derived rule IDs/messages/thresholds
// should match your real repo, but the exact token-matching logic is a
// fresh implementation, not a byte-for-byte recovery. Diff against your
// real CppRules.cpp before trusting it in place of the original.
//
// Rules:
//   cpp-raw-new-delete             bare 'new'/'delete' keyword usage
//   cpp-using-namespace-std-header 'using namespace std;' in a .h/.hpp file
//   cpp-catch-all-ellipsis         empty catch (...) body
//   cpp-magic-number-literal       numeric literal other than 0/1 inside an
//                                  if/while condition
//   cpp-long-function              functions[].lineCount() > 100
//   cpp-deep-nesting               file-level maxNestingDepth > 6
//   cpp-todo-without-ticket        TODO/FIXME with no #123 or PROJ-123 ref
[[nodiscard]] std::vector<Violation> checkCppRules(
    const std::string& path, const std::vector<Token>& tokens, const FileMetrics& fm);
 
} // namespace cma
 
