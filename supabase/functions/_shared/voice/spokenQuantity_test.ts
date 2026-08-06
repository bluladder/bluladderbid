import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseSpokenQuantity, spokenToNumber } from "./spokenQuantity.ts";

const zeroThroughTwenty: Array<[string, number]> = [
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
];

Deno.test("spoken quantity accepts every whole number from zero through twenty", () => {
  for (const [spoken, expected] of zeroThroughTwenty) {
    assertEquals(parseSpokenQuantity(spoken), expected, spoken);
  }
});

Deno.test("spoken quantity accepts normal larger forms and natural wrappers", () => {
  const cases: Array<[string, number]> = [
    ["twenty-one", 21],
    ["twenty five", 25],
    ["ninety-nine", 99],
    ["one hundred", 100],
    ["one hundred twenty-five", 125],
    ["five hundred", 500],
    ["twenty five hundred", 2500],
    ["two thousand five hundred", 2500],
    ["there are two windows", 2],
    ["I have about twelve panels", 12],
    ["roughly one hundred feet", 100],
    ["2 tall windows", 2],
    ["2,500 square feet", 2500],
  ];
  for (const [spoken, expected] of cases) {
    assertEquals(parseSpokenQuantity(spoken), expected, spoken);
  }
});

Deno.test("spoken quantity supports half-window equivalents", () => {
  const cases: Array<[string, number]> = [
    ["half", 0.5],
    ["one and a half", 1.5],
    ["two and a half", 2.5],
    ["two point five", 2.5],
    ["2.5", 2.5],
  ];
  for (const [spoken, expected] of cases) {
    assertEquals(
      parseSpokenQuantity(spoken, { min: 0.5, step: 0.5 }),
      expected,
      spoken,
    );
  }
});

Deno.test("phase3 spoken quantity strips terminal punctuation without damaging decimals", () => {
  assertEquals(parseSpokenQuantity("Two."), 2);
  assertEquals(parseSpokenQuantity("2.5.", { min: 0.5, step: 0.5 }), 2.5);
  assertEquals(parseSpokenQuantity("Two, please."), 2);
});

Deno.test("spoken quantity rejects ambiguity, addresses and invalid field shapes", () => {
  assertEquals(parseSpokenQuantity("one or two"), undefined);
  assertEquals(parseSpokenQuantity("5612 Binbranch Lane"), undefined);
  assertEquals(parseSpokenQuantity("call me at 469 257 9263"), undefined);
  assertEquals(
    parseSpokenQuantity("two and a half", { integer: true }),
    undefined,
  );
  assertEquals(parseSpokenQuantity("twenty", { max: 19 }), undefined);
});

Deno.test("clean spoken number converter preserves square-footage forms", () => {
  assertEquals(spokenToNumber("two five zero zero"), 2500);
  assertEquals(spokenToNumber("twenty five hundred"), 2500);
  assertEquals(spokenToNumber("two thousand five hundred"), 2500);
  assertEquals(spokenToNumber("2500"), 2500);
});
