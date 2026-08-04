#pragma once
 
#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"
 
#include <string>
#include <vector>
 
namespace cma {
 
// Java anti-pattern / best-practice rule catalog -- Phase 4 Sprint 3B
// (7 rules). Same "token stream + FileMetrics only" contract as CppRules.h.
//
// RECONSTRUCTED FILE -- see CppRules.h's header comment; same caveat
// applies here.
//
// Rules:
//   java-empty-catch-block   empty catch (Type name) { } body
//   java-public-field        a public field (excludes public static final
//                            constants and methods)
//   java-printstacktrace     .printStackTrace() call
//   java-long-method         same threshold as C++'s
//   java-deep-nesting        same threshold as C++'s
//   java-raw-type-usage      a known collection type used without a
//                            generic parameter
//   java-todo-without-ticket same shape as C++'s
[[nodiscard]] std::vector<Violation> checkJavaRules(
    const std::string& path, const std::vector<Token>& tokens, const FileMetrics& fm);
 
} // namespace cma
 
