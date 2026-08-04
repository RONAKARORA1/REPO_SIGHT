// Unit tests for PythonLexer — the Phase 2 Python front-end's tokenizer.
// Mirrors test_lexer.cpp's structure/conventions from Phase 0
// (PHASE0_TESTING.md), one TEST() per behavior, GoogleTest.
 
#include "lexer/PythonLexer.h"
 
#include <gtest/gtest.h>
 
using namespace cma;
 
namespace {
std::vector<Token> lex(const std::string& src) {
    PythonLexer lexer(src);
    return lexer.tokenize();
}
} // namespace
 
// ── Keywords / identifiers ─────────────────────────────────────────────────
 
TEST(PythonLexer, RecognizesHardKeywords) {
    auto toks = lex("def class if elif else for while return");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) { // last is END_OF_FILE
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}
 
TEST(PythonLexer, TreatsMatchCaseAsKeywords) {
    auto toks = lex("match case");
    EXPECT_EQ(toks[0].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[1].type, TokenType::KEYWORD);
}
 
TEST(PythonLexer, UnderscoreIsNeverAKeyword) {
    // '_' is a soft keyword only inside match/case patterns; treating it as
    // an ordinary identifier everywhere is the documented simplification.
    auto toks = lex("_ = 5");
    EXPECT_EQ(toks[0].type, TokenType::IDENTIFIER);
}
 
TEST(PythonLexer, BuiltinTypeNamesAreIdentifiersNotKeywords) {
    // Unlike C++, int/str/float are NOT reserved words in Python.
    auto toks = lex("x: int = 0");
    ASSERT_EQ(toks.size(), 6u); // x : int = 0 EOF
    EXPECT_EQ(toks[2].type, TokenType::IDENTIFIER);
    EXPECT_EQ(toks[2].value, "int");
}
 
// ── Strings ─────────────────────────────────────────────────────────────────
 
TEST(PythonLexer, SimpleSingleAndDoubleQuotedStrings) {
    auto toks = lex(R"('hello' "world")");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_EQ(toks[1].type, TokenType::STRING_LITERAL);
}
 
TEST(PythonLexer, PrefixedStringsRBUF) {
    auto toks = lex(R"(r'raw' b"bytes" f'fstr' rb'rawbytes')");
    for (int i = 0; i < 4; ++i) {
        EXPECT_EQ(toks[static_cast<std::size_t>(i)].type, TokenType::STRING_LITERAL);
    }
}
 
TEST(PythonLexer, TripleQuotedStringSpansMultipleLinesInValue) {
    auto toks = lex("\"\"\"line one\nline two\"\"\"");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}
 
TEST(PythonLexer, UnterminatedSingleLineStringRecoversGracefully) {
    auto toks = lex("x = 'oops\ny = 1");
    // Should not crash/hang; a NEWLINE follows the unterminated literal,
    // and lexing continues.
    bool sawY = false;
    for (const auto& t : toks) if (t.value == "y") sawY = true;
    EXPECT_TRUE(sawY);
}
 
// ── Numbers ─────────────────────────────────────────────────────────────────
 
TEST(PythonLexer, NumbersWithUnderscoreSeparators) {
    auto toks = lex("1_000_000");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "1_000_000");
}
 
TEST(PythonLexer, ComplexSuffixAbsorbed) {
    auto toks = lex("3j");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "3j");
}
 
// ── Comments ────────────────────────────────────────────────────────────────
 
TEST(PythonLexer, HashCommentToEndOfLine) {
    auto toks = lex("x = 1  # a comment\ny = 2");
    bool sawComment = false;
    for (const auto& t : toks) {
        if (t.type == TokenType::LINE_COMMENT) {
            sawComment = true;
            EXPECT_NE(t.value.find("a comment"), std::string::npos);
        }
    }
    EXPECT_TRUE(sawComment);
}
 
// ── Operators ───────────────────────────────────────────────────────────────
 
TEST(PythonLexer, MultiCharOperatorsAreSingleTokens) {
    auto toks = lex("a == b");
    ASSERT_GE(toks.size(), 3u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "==");
}
 
TEST(PythonLexer, AugmentedAssignmentIsNotBareEquals) {
    auto toks = lex("x += 1");
    EXPECT_EQ(toks[1].value, "+=");
    EXPECT_NE(toks[1].value, "=");
}
 
TEST(PythonLexer, ArrowOperatorForReturnType) {
    auto toks = lex("def f() -> int: pass");
    bool sawArrow = false;
    for (const auto& t : toks) if (t.value == "->") sawArrow = true;
    EXPECT_TRUE(sawArrow);
}
 
TEST(PythonLexer, DotIsAnOperatorNotPunctuation) {
    // Regression test: '.' must be OPERATOR (PythonParser's attribute-
    // assignment exclusion depends on this).
    auto toks = lex("self.name");
    ASSERT_EQ(toks.size(), 4u); // self . name EOF
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, ".");
}
 
// ── Implicit line joining / continuation ────────────────────────────────────
 
TEST(PythonLexer, NewlineSuppressedInsideParens) {
    auto toks = lex("x = (\n    1\n)\ny = 2");
    int newlineCount = 0;
    for (const auto& t : toks) if (t.type == TokenType::NEWLINE) ++newlineCount;
    // Only the newline after the closing ')' (before 'y') should survive.
    EXPECT_EQ(newlineCount, 1);
}
 
TEST(PythonLexer, BackslashContinuationSuppressesNewline) {
    auto toks = lex("x = 1 + \\\n    2");
    for (const auto& t : toks) EXPECT_NE(t.type, TokenType::NEWLINE);
}
 
// ── Structural tokens ────────────────────────────────────────────────────────
 
TEST(PythonLexer, EndsWithEndOfFileSentinel) {
    auto toks = lex("x = 1");
    EXPECT_EQ(toks.back().type, TokenType::END_OF_FILE);
}
 
TEST(PythonLexer, BracketsMapToSharedDelimiterTypes) {
    auto toks = lex("[1, 2] (3) {4: 5}");
    EXPECT_EQ(toks[0].type, TokenType::OPEN_BRACKET);
    EXPECT_EQ(toks[4].type, TokenType::CLOSE_BRACKET);
}
 
