// Unit tests for PythonParser — the Phase 2 Python front-end's structural
// analyzer. Mirrors test_parser.cpp's structure/conventions from Phase 0
// (PHASE0_TESTING.md), one TEST() per behavior, GoogleTest.
 
#include "parser/PythonParser.h"
#include "lexer/PythonLexer.h"
 
#include <gtest/gtest.h>
 
using namespace cma;
 
namespace {
FileMetrics analyze(const std::string& src) {
    PythonLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    PythonParser parser(tokens, lineCount);
    return parser.analyze();
}
} // namespace
 
// ── Function detection ──────────────────────────────────────────────────────
 
TEST(PythonParser, DetectsTopLevelFunction) {
    auto fm = analyze("def foo():\n    return 1\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "foo");
    EXPECT_EQ(fm.functions[0].startLine, 1);
}
 
TEST(PythonParser, DetectsNestedClosureFunction) {
    auto fm = analyze(
        "def outer():\n"
        "    def inner():\n"
        "        return 1\n"
        "    return inner\n");
    EXPECT_EQ(fm.functionCount(), 2);
}
 
TEST(PythonParser, MethodInsideClassIsDetected) {
    auto fm = analyze(
        "class Widget:\n"
        "    def method(self):\n"
        "        return self\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "method");
}
 
TEST(PythonParser, TwoSiblingFunctionsBothClose) {
    auto fm = analyze(
        "def foo():\n"
        "    return 1\n"
        "def bar():\n"
        "    return 2\n");
    ASSERT_EQ(fm.functionCount(), 2);
    EXPECT_LT(fm.functions[0].endLine, fm.functions[1].startLine + 1);
}
 
TEST(PythonParser, FunctionWithReturnTypeArrowStillDetected) {
    auto fm = analyze("def f(x) -> int:\n    return x\n");
    ASSERT_EQ(fm.functionCount(), 1);
}
 
TEST(PythonParser, FunctionOpenAtEofIsClosed) {
    auto fm = analyze("def f():\n    return 1");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_GT(fm.functions[0].endLine, 0);
}
 
// ── Class detection ──────────────────────────────────────────────────────────
 
TEST(PythonParser, DetectsClassWithNoBases) {
    auto fm = analyze("class Foo:\n    pass\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Foo");
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
}
 
TEST(PythonParser, DetectsClassWithBases) {
    auto fm = analyze("class Foo(Base):\n    pass\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Foo");
}
 
// ── Complexity / condition / loop counting ───────────────────────────────────
 
TEST(PythonParser, IfElifEachCountSeparately) {
    auto fm = analyze(
        "def f(x):\n"
        "    if x == 1:\n"
        "        return 1\n"
        "    elif x == 2:\n"
        "        return 2\n"
        "    else:\n"
        "        return 3\n");
    EXPECT_EQ(fm.conditionCount, 2);       // if + elif, not else
    EXPECT_EQ(fm.cyclomaticComplexity, 3); // base 1 + if + elif
}
 
TEST(PythonParser, ForAndWhileCountAsLoops) {
    auto fm = analyze(
        "def f():\n"
        "    for i in range(3):\n"
        "        pass\n"
        "    while True:\n"
        "        break\n");
    EXPECT_EQ(fm.loopCount, 2);
}
 
TEST(PythonParser, AndOrAddComplexityWithoutTwoTokenTrick) {
    auto fm = analyze("def f(a, b):\n    if a and b or not a:\n        return 1\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}
 
TEST(PythonParser, TryExceptFinally) {
    auto fm = analyze(
        "def f():\n"
        "    try:\n"
        "        risky()\n"
        "    except ValueError:\n"
        "        pass\n"
        "    except TypeError:\n"
        "        pass\n"
        "    finally:\n"
        "        cleanup()\n");
    EXPECT_EQ(fm.tryCatchCount, 1);
    EXPECT_EQ(fm.cyclomaticComplexity, 3);
}
 
TEST(PythonParser, MatchCaseLikeSwitchCase) {
    auto fm = analyze(
        "def f(x):\n"
        "    match x:\n"
        "        case 0:\n"
        "            return 'zero'\n"
        "        case _:\n"
        "            return 'other'\n");
    EXPECT_EQ(fm.conditionCount, 1);
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}
 
// ── Variable counting ─────────────────────────────────────────────────────────
 
TEST(PythonParser, SimpleAssignmentCounts) {
    auto fm = analyze("x = 1\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(PythonParser, AnnotatedAssignmentCountsOnceNotTwice) {
    auto fm = analyze("x: int = 0\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(PythonParser, AnnotationOnlyWithoutValueCounts) {
    auto fm = analyze("x: int\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(PythonParser, AttributeAssignmentDoesNotCount) {
    auto fm = analyze(
        "def f(self, name):\n"
        "    self.name = name\n");
    EXPECT_EQ(fm.variableCount, 0);
}
 
TEST(PythonParser, AugmentedAssignmentDoesNotCount) {
    auto fm = analyze("x = 1\nx += 1\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(PythonParser, CallKeywordArgsDoNotCount) {
    auto fm = analyze("foo(x=1, y=2)\n");
    EXPECT_EQ(fm.variableCount, 0);
}
 
TEST(PythonParser, ForLoopAndComprehensionTargetsDoNotCount) {
    auto fm = analyze("for i in range(3):\n    pass\nresult = [x for x in range(3)]\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(PythonParser, CompoundStatementHeaderEndingInIdentifierDoesNotCount) {
    auto fm = analyze(
        "def f(x):\n"
        "    match x:\n"
        "        case 0:\n"
        "            return 0\n");
    EXPECT_EQ(fm.variableCount, 0);
}
 
TEST(PythonParser, SubscriptAssignmentDoesNotCount) {
    auto fm = analyze("d = {}\nd[0] = 1\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
// ── Line classification / comments / TODO ────────────────────────────────────
 
TEST(PythonParser, HashCommentLineIsCounted) {
    auto fm = analyze("# just a comment\n");
    EXPECT_EQ(fm.commentLines, 1);
    EXPECT_EQ(fm.codeLines, 0);
}
 
TEST(PythonParser, TripleQuotedDocstringSpansCountAsCode) {
    auto fm = analyze("\"\"\"line one\nline two\nline three\"\"\"\n");
    EXPECT_EQ(fm.codeLines, 3);
    EXPECT_EQ(fm.commentLines, 0);
}
 
TEST(PythonParser, TodoAndFixmeCountedInComments) {
    auto fm = analyze("# TODO: fix this\n# FIXME: also this\n");
    EXPECT_EQ(fm.todoCount, 2);
}
 
TEST(PythonParser, BlankLinesCounted) {
    auto fm = analyze("x = 1\n\n\ny = 2\n");
    EXPECT_EQ(fm.blankLines, 3);
}
 
// ── Imports / coupling metric ─────────────────────────────────────────────────
 
TEST(PythonParser, PlainImportCountsOnce) {
    auto fm = analyze("import os\n");
    EXPECT_EQ(fm.includeCount, 1);
}
 
TEST(PythonParser, FromImportCountsOnceNotTwice) {
    auto fm = analyze("from collections import OrderedDict\n");
    EXPECT_EQ(fm.includeCount, 1);
}
 
TEST(PythonParser, MultipleImportStatementsEachCount) {
    auto fm = analyze("import os\nfrom sys import argv\nimport json\n");
    EXPECT_EQ(fm.includeCount, 3);
}
 
// ── Nesting depth ──────────────────────────────────────────────────────────────
 
TEST(PythonParser, MaxNestingDepthTracksIndentation) {
    auto fm = analyze(
        "def f():\n"
        "    if True:\n"
        "        if True:\n"
        "            pass\n"
    );
    EXPECT_EQ(fm.maxNestingDepth, 3);
}
 
TEST(PythonParser, TopLevelCodeHasZeroNestingDepth) {
    auto fm = analyze("x = 1\ny = 2\n");
    EXPECT_EQ(fm.maxNestingDepth, 0);
}
 
