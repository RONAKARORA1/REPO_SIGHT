// Unit tests for JavaLexer — the Phase 3 Java front-end's tokenizer.
// Mirrors test_python_lexer.cpp's structure/conventions from Phase 2
// (PHASE2_TESTING.md), one TEST() per behavior, GoogleTest.
 
#include "lexer/JavaLexer.h"
 
#include <gtest/gtest.h>
 
using namespace cma;
 
namespace {
std::vector<Token> lex(const std::string& src) {
    JavaLexer lexer(src);
    return lexer.tokenize();
}
} // namespace
 
TEST(JavaLexer, RecognizesTrueReservedKeywords) {
    auto toks = lex("class if else for while return");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}
 
TEST(JavaLexer, ReservedLiteralsAreKeywords) {
    auto toks = lex("true false null");
    EXPECT_EQ(toks[0].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[1].type, TokenType::KEYWORD);
    EXPECT_EQ(toks[2].type, TokenType::KEYWORD);
}
 
TEST(JavaLexer, ContextualKeywordsTreatedAsAlwaysKeywords) {
    auto toks = lex("var record yield sealed permits");
    for (std::size_t i = 0; i + 1 < toks.size(); ++i) {
        EXPECT_EQ(toks[i].type, TokenType::KEYWORD) << "token: " << toks[i].value;
    }
}
 
TEST(JavaLexer, IdentifiersMayContainDollarSign) {
    auto toks = lex("Outer$Inner x$1 $leading");
    EXPECT_EQ(toks[0].type, TokenType::IDENTIFIER);
    EXPECT_EQ(toks[0].value, "Outer$Inner");
    EXPECT_EQ(toks[1].value, "x$1");
    EXPECT_EQ(toks[2].value, "$leading");
}
 
TEST(JavaLexer, BuiltinReferenceTypeNamesAreIdentifiersNotKeywords) {
    auto toks = lex("String s = null;");
    EXPECT_EQ(toks[0].type, TokenType::IDENTIFIER);
    EXPECT_EQ(toks[0].value, "String");
}
 
TEST(JavaLexer, SimpleDoubleQuotedString) {
    auto toks = lex(R"("hello world")");
    EXPECT_EQ(toks[0].type, TokenType::STRING_LITERAL);
}
 
TEST(JavaLexer, SingleQuoteIsAlwaysCharLiteralNeverString) {
    auto toks = lex("'x'");
    EXPECT_EQ(toks[0].type, TokenType::CHAR_LITERAL);
}
 
TEST(JavaLexer, EscapedCharLiteral) {
    auto toks = lex(R"('\n')");
    EXPECT_EQ(toks[0].type, TokenType::CHAR_LITERAL);
}
 
TEST(JavaLexer, TextBlockSpansMultipleLinesInValue) {
    auto toks = lex("\"\"\"\nline one\nline two\n\"\"\"");
    ASSERT_EQ(toks[0].type, TokenType::STRING_LITERAL);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}
 
TEST(JavaLexer, UnterminatedSingleLineStringRecoversGracefully) {
    auto toks = lex("x = \"oops\ny = 1");
    bool sawY = false;
    for (const auto& t : toks) if (t.value == "y") sawY = true;
    EXPECT_TRUE(sawY);
}
 
TEST(JavaLexer, NumbersWithUnderscoreSeparators) {
    auto toks = lex("1_000_000");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "1_000_000");
}
 
TEST(JavaLexer, LongSuffixAbsorbed) {
    auto toks = lex("100L");
    EXPECT_EQ(toks[0].type, TokenType::NUMBER_LITERAL);
    EXPECT_EQ(toks[0].value, "100L");
}
 
TEST(JavaLexer, FloatDoubleSuffixesAbsorbed) {
    auto toks = lex("3.14f 2.5d");
    EXPECT_EQ(toks[0].value, "3.14f");
    EXPECT_EQ(toks[1].value, "2.5d");
}
 
TEST(JavaLexer, HexAndBinaryLiterals) {
    auto toks = lex("0x1F 0b1010");
    EXPECT_EQ(toks[0].value, "0x1F");
    EXPECT_EQ(toks[1].value, "0b1010");
}
 
TEST(JavaLexer, LineCommentToEndOfLine) {
    auto toks = lex("x = 1;  // a comment\ny = 2;");
    bool sawComment = false;
    for (const auto& t : toks) {
        if (t.type == TokenType::LINE_COMMENT) {
            sawComment = true;
            EXPECT_NE(t.value.find("a comment"), std::string::npos);
        }
    }
    EXPECT_TRUE(sawComment);
}
 
TEST(JavaLexer, BlockCommentSpansMultipleLines) {
    auto toks = lex("/* line one\nline two */");
    ASSERT_EQ(toks[0].type, TokenType::BLOCK_COMMENT);
    EXPECT_NE(toks[0].value.find('\n'), std::string::npos);
}
 
TEST(JavaLexer, JavadocCommentIsOrdinaryBlockComment) {
    auto toks = lex("/** javadoc */");
    EXPECT_EQ(toks[0].type, TokenType::BLOCK_COMMENT);
}
 
TEST(JavaLexer, NoPreprocessorTokenEverEmitted) {
    auto toks = lex("class X { }");
    for (const auto& t : toks) EXPECT_NE(t.type, TokenType::PREPROCESSOR);
}
 
TEST(JavaLexer, OperatorsAreSingleCharacterNeverPreCombined) {
    auto toks = lex("a && b");
    ASSERT_GE(toks.size(), 3u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, "&");
    EXPECT_EQ(toks[2].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[2].value, "&");
}
 
TEST(JavaLexer, DotIsAnOperator) {
    auto toks = lex("obj.field");
    ASSERT_EQ(toks.size(), 4u);
    EXPECT_EQ(toks[1].type, TokenType::OPERATOR);
    EXPECT_EQ(toks[1].value, ".");
}
 
TEST(JavaLexer, AtSignIsPunctuationNotOperator) {
    auto toks = lex("@Override");
    EXPECT_EQ(toks[0].type, TokenType::PUNCTUATION);
    EXPECT_EQ(toks[0].value, "@");
}
 
TEST(JavaLexer, BracesParensBracketsMapToDedicatedTypes) {
    auto toks = lex("{ ( [ ] ) }");
    EXPECT_EQ(toks[0].type, TokenType::OPEN_BRACE);
    EXPECT_EQ(toks[1].type, TokenType::OPEN_PAREN);
    EXPECT_EQ(toks[2].type, TokenType::OPEN_BRACKET);
    EXPECT_EQ(toks[3].type, TokenType::CLOSE_BRACKET);
    EXPECT_EQ(toks[4].type, TokenType::CLOSE_PAREN);
    EXPECT_EQ(toks[5].type, TokenType::CLOSE_BRACE);
}
 
TEST(JavaLexer, SemicolonHasDedicatedType) {
    auto toks = lex("x = 1;");
    bool sawSemi = false;
    for (const auto& t : toks) if (t.type == TokenType::SEMICOLON) sawSemi = true;
    EXPECT_TRUE(sawSemi);
}
 
TEST(JavaLexer, NewlinesAlwaysEmittedNoImplicitJoining) {
    auto toks = lex("foo(\n1,\n2\n)");
    int newlineCount = 0;
    for (const auto& t : toks) if (t.type == TokenType::NEWLINE) ++newlineCount;
    EXPECT_EQ(newlineCount, 3);
}
 
TEST(JavaLexer, EndsWithEndOfFileSentinel) {
    auto toks = lex("x = 1;");
    EXPECT_EQ(toks.back().type, TokenType::END_OF_FILE);
}
 
