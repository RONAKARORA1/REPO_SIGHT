// Unit tests for JavaParser — the Phase 3 Java front-end's structural
// analyzer. Mirrors test_python_parser.cpp's structure/conventions from
// Phase 2 (PHASE2_TESTING.md), one TEST() per behavior, GoogleTest.
 
#include "parser/JavaParser.h"
#include "lexer/JavaLexer.h"
 
#include <gtest/gtest.h>
 
using namespace cma;
 
namespace {
FileMetrics analyze(const std::string& src) {
    JavaLexer lexer(src);
    auto tokens = lexer.tokenize();
    int lineCount = 1;
    for (char c : src) if (c == '\n') ++lineCount;
    JavaParser parser(tokens, lineCount);
    return parser.analyze();
}
} // namespace
 
TEST(JavaParser, DetectsMethodInsideClass) {
    auto fm = analyze("class X {\n    void foo() {\n        return;\n    }\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "foo");
}
 
TEST(JavaParser, DetectsMultipleSiblingMethods) {
    auto fm = analyze(
        "class X {\n"
        "    void a() { }\n"
        "    void b() { }\n"
        "    void c() { }\n"
        "}\n");
    EXPECT_EQ(fm.functionCount(), 3);
}
 
TEST(JavaParser, DetectsMethodInsideNestedInnerClass) {
    auto fm = analyze(
        "class Outer {\n"
        "    class Inner {\n"
        "        void innerMethod() {\n"
        "            return;\n"
        "        }\n"
        "    }\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "innerMethod");
}
 
TEST(JavaParser, AbstractMethodDeclarationWithoutBodyIsNotCounted) {
    auto fm = analyze("interface X {\n    void greet();\n}\n");
    EXPECT_EQ(fm.functionCount(), 0);
}
 
TEST(JavaParser, MethodWithThrowsClauseStillDetected) {
    auto fm = analyze(
        "class X {\n"
        "    void risky() throws java.io.IOException, RuntimeException {\n"
        "        return;\n"
        "    }\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "risky");
}
 
TEST(JavaParser, AbstractMethodWithThrowsAndNoBodyIsNotCounted) {
    auto fm = analyze("interface X {\n    void risky() throws Exception;\n}\n");
    EXPECT_EQ(fm.functionCount(), 0);
}
 
TEST(JavaParser, ConstructorLikeMethodIsDetected) {
    auto fm = analyze("class Point {\n    Point(int x, int y) {\n        return;\n    }\n}\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_EQ(fm.functions[0].name, "Point");
}
 
TEST(JavaParser, AnonymousClassInstantiationIsNotMisdetectedAsFunction) {
    auto fm = analyze(
        "class X {\n"
        "    Runnable make() {\n"
        "        return new Runnable() {\n"
        "            public void run() {\n"
        "                return;\n"
        "            }\n"
        "        };\n"
        "    }\n"
        "}\n");
    ASSERT_EQ(fm.functionCount(), 2);
    bool sawRunnable = false;
    for (const auto& fn : fm.functions) if (fn.name == "Runnable") sawRunnable = true;
    EXPECT_FALSE(sawRunnable);
}
 
TEST(JavaParser, RecordCanonicalConstructorIsNotMisdetectedAsFunction) {
    auto fm = analyze("record Point(int x, int y) { }\n");
    EXPECT_EQ(fm.functionCount(), 0);
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Point");
}
 
TEST(JavaParser, MethodOpenAtEofIsClosed) {
    auto fm = analyze("class X {\n    void f() {\n        return;\n");
    ASSERT_EQ(fm.functionCount(), 1);
    EXPECT_GT(fm.functions[0].endLine, 0);
}
 
TEST(JavaParser, DetectsClass) {
    auto fm = analyze("class Foo { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].name, "Foo");
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
}
 
TEST(JavaParser, InterfaceMapsToClassKind) {
    auto fm = analyze("interface Foo { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::CLASS);
}
 
TEST(JavaParser, EnumMapsToEnumKind) {
    auto fm = analyze("enum Color { RED, GREEN, BLUE }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::ENUM);
}
 
TEST(JavaParser, RecordMapsToStructKind) {
    auto fm = analyze("record Point(int x, int y) { }\n");
    ASSERT_EQ(fm.classCount(), 1);
    EXPECT_EQ(fm.classes[0].kind, ClassInfo::Kind::STRUCT);
}
 
TEST(JavaParser, ElseIfCountsAsIndependentDecisionPoint) {
    auto fm = analyze(
        "class X {\n"
        "    int f(int x) {\n"
        "        if (x == 1) { return 1; }\n"
        "        else if (x == 2) { return 2; }\n"
        "        else { return 3; }\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.conditionCount, 2);
    EXPECT_EQ(fm.cyclomaticComplexity, 3);
}
 
TEST(JavaParser, ForWhileDoAllCountAsLoops) {
    auto fm = analyze(
        "class X {\n"
        "    void f() {\n"
        "        for (int i = 0; i < 3; i++) { }\n"
        "        while (true) { break; }\n"
        "        do { } while (false);\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.loopCount, 4);
}
 
TEST(JavaParser, LogicalAndOrDetectedViaTwoTokenTrick) {
    auto fm = analyze(
        "class X {\n"
        "    boolean f(boolean a, boolean b) {\n"
        "        if (a && b || !a) { return true; }\n"
        "        return false;\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}
 
TEST(JavaParser, TernaryAddsComplexity) {
    auto fm = analyze("class X {\n    int f(int a, int b) {\n        return a > b ? a : b;\n    }\n}\n");
    EXPECT_EQ(fm.cyclomaticComplexity, 2);
}
 
TEST(JavaParser, TryCatchFinally) {
    auto fm = analyze(
        "class X {\n"
        "    void f() {\n"
        "        try {\n"
        "            risky();\n"
        "        } catch (RuntimeException e) {\n"
        "            handle();\n"
        "        } catch (Exception e) {\n"
        "            handle();\n"
        "        } finally {\n"
        "            cleanup();\n"
        "        }\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.tryCatchCount, 1);
    EXPECT_EQ(fm.cyclomaticComplexity, 3);
}
 
TEST(JavaParser, SwitchCaseLikeCpp) {
    auto fm = analyze(
        "class X {\n"
        "    String f(int code) {\n"
        "        switch (code) {\n"
        "            case 1:\n"
        "                return \"one\";\n"
        "            case 2:\n"
        "                return \"two\";\n"
        "            default:\n"
        "                return \"other\";\n"
        "        }\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.conditionCount, 1);
    EXPECT_EQ(fm.cyclomaticComplexity, 4);
}
 
TEST(JavaParser, PrimitiveDeclarationCounts) {
    auto fm = analyze("class X {\n    void f() {\n        int x = 1;\n    }\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(JavaParser, VarDeclarationCounts) {
    auto fm = analyze("class X {\n    void f() {\n        var x = 1;\n    }\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(JavaParser, FinalModifierDoesNotBlockCounting) {
    auto fm = analyze("class X {\n    void f() {\n        final int x = 1;\n    }\n}\n");
    EXPECT_EQ(fm.variableCount, 1);
}
 
TEST(JavaParser, ReferenceTypeDeclarationDoesNotCount) {
    auto fm = analyze("class X {\n    void f() {\n        String s = \"x\";\n    }\n}\n");
    EXPECT_EQ(fm.variableCount, 0);
}
 
TEST(JavaParser, GenericTypeDeclarationDoesNotCount) {
    auto fm = analyze(
        "class X {\n"
        "    void f() {\n"
        "        java.util.List<String> names = null;\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.variableCount, 0);
}
 
TEST(JavaParser, ArrayBracketSuffixDoesNotCount) {
    auto fm = analyze("class X {\n    void f() {\n        int[] arr = null;\n    }\n}\n");
    EXPECT_EQ(fm.variableCount, 0);
}
 
TEST(JavaParser, MethodParametersCount) {
    auto fm = analyze("class X {\n    int f(int a, boolean b) {\n        return a;\n    }\n}\n");
    EXPECT_EQ(fm.variableCount, 2);
}
 
TEST(JavaParser, MethodNameItselfIsNotCountedAsVariable) {
    auto fm = analyze("class X {\n    int compute() {\n        return 0;\n    }\n}\n");
    EXPECT_EQ(fm.variableCount, 0);
}
 
TEST(JavaParser, LineCommentIsCounted) {
    auto fm = analyze("// just a comment\n");
    EXPECT_EQ(fm.commentLines, 1);
    EXPECT_EQ(fm.codeLines, 0);
}
 
TEST(JavaParser, BlockCommentSpansMultipleLines) {
    auto fm = analyze("/* line one\nline two\nline three */\n");
    EXPECT_EQ(fm.commentLines, 3);
}
 
TEST(JavaParser, TodoAndFixmeCountedInComments) {
    auto fm = analyze("// TODO: fix this\n// FIXME: also this\n");
    EXPECT_EQ(fm.todoCount, 2);
}
 
TEST(JavaParser, TextBlockSpansCountAsCode) {
    auto fm = analyze("class X {\n    String s = \"\"\"\n        a\n        b\n        \"\"\";\n}\n");
    EXPECT_EQ(fm.commentLines, 0);
}
 
TEST(JavaParser, PlainImportCountsOnce) {
    auto fm = analyze("import java.util.List;\n");
    EXPECT_EQ(fm.includeCount, 1);
}
 
TEST(JavaParser, MultipleImportStatementsEachCount) {
    auto fm = analyze("import java.util.List;\nimport java.util.ArrayList;\nimport java.io.IOException;\n");
    EXPECT_EQ(fm.includeCount, 3);
}
 
TEST(JavaParser, MaxNestingDepthTracksBraceDepth) {
    auto fm = analyze(
        "class X {\n"
        "    void f() {\n"
        "        if (true) {\n"
        "            if (true) {\n"
        "                return;\n"
        "            }\n"
        "        }\n"
        "    }\n"
        "}\n");
    EXPECT_EQ(fm.maxNestingDepth, 4);
}
 
TEST(JavaParser, EmptyClassHasDepthOne) {
    auto fm = analyze("class X { }\n");
    EXPECT_EQ(fm.maxNestingDepth, 1);
}
 
TEST(JavaParser, BraceBlockAnalyzerNeverGoesNegativeOnUnbalancedInput) {
    auto fm = analyze("} } } class X { \n");
    EXPECT_GE(fm.maxNestingDepth, 0);
}
 
