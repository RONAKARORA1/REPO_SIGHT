#pragma once
 
#include "lexer/Token.h"
#include "parser/ParseResult.h"
#include "metrics/ViolationReport.h"
 
#include <string>
#include <vector>
 
namespace cma {
 
// Python anti-pattern / best-practice rule catalog -- Phase 4 Sprint 3B
// (7 rules). Same "token stream + FileMetrics only" contract as CppRules.h.
//
// RECONSTRUCTED FILE -- see CppRules.h's header comment; same caveat
// applies here.
//
// Rules:
//   py-mutable-default-arg      def f(x=[]) / def f(x={})
//   py-bare-except              except: with no exception type
//   py-wildcard-import          from x import *
//   py-long-function            same threshold as C++'s
//   py-deep-nesting             same threshold as C++'s
//   py-mutable-class-attribute  class-body-level x=[...]/x={...} assignment,
//                               excluding anything after the class's first def
//   py-todo-without-ticket      same shape as C++'s
[[nodiscard]] std::vector<Violation> checkPythonRules(
    const std::string& path, const std::vector<Token>& tokens, const FileMetrics& fm);
 
} // namespace cma
 
