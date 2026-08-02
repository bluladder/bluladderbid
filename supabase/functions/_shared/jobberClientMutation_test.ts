import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildJobberBookingLineItems,
  jobberBookingLineItemsTotal,
  jobberGraphQLMutation,
} from "./jobberClient.ts";

type StubCase = {
  name: string;
  response?: Response;
  throws?: boolean;
  expectedUncertain?: boolean;
  expectedThrottled?: boolean;
};

const cases: StubCase[] = [
  {
    name: "accepts one authoritative success response",
    response: new Response(JSON.stringify({ data: { id: "job_1" } }), {
      status: 200,
    }),
    expectedUncertain: false,
  },
  {
    name: "marks a malformed success response uncertain",
    response: new Response("not-json", { status: 200 }),
    expectedUncertain: true,
  },
  {
    name: "marks a server failure uncertain",
    response: new Response(JSON.stringify({}), { status: 503 }),
    expectedUncertain: true,
  },
  {
    name: "marks top-level GraphQL mutation errors uncertain",
    response: new Response(
      JSON.stringify({ errors: [{ message: "unknown mutation outcome" }] }),
      { status: 200 },
    ),
    expectedUncertain: true,
  },
  {
    name: "does not retry a rate-limited mutation",
    response: new Response(JSON.stringify({}), { status: 429 }),
    expectedUncertain: false,
    expectedThrottled: true,
  },
  {
    name: "treats an explicit client rejection as known and non-retryable",
    response: new Response(
      JSON.stringify({ errors: [{ message: "invalid input" }] }),
      { status: 400 },
    ),
    expectedUncertain: false,
  },
  {
    name: "marks a transport failure uncertain",
    throws: true,
    expectedUncertain: true,
  },
];

for (const testCase of cases) {
  Deno.test(`Jobber mutation ${testCase.name}`, async () => {
    let calls = 0;
    const result = await jobberGraphQLMutation<{ id: string }>(
      "mutation CreateJob { jobCreate { job { id } } }",
      {},
      {
        getAccessToken: () => Promise.resolve("stub-token"),
        fetch: (() => {
          calls += 1;
          if (testCase.throws) {
            return Promise.reject(new TypeError("connection reset"));
          }
          return Promise.resolve(testCase.response!);
        }) as typeof fetch,
      },
    );

    assertEquals(
      calls,
      1,
      "a non-idempotent provider mutation ran more than once",
    );
    assertEquals(result.outcomeUncertain === true, testCase.expectedUncertain);
    assertEquals(
      result.throttled === true,
      testCase.expectedThrottled ?? false,
    );
    if (testCase.expectedUncertain) assert(result.errors?.length);
  });
}

Deno.test("Jobber mutation does not call the provider without a token", async () => {
  let calls = 0;
  const result = await jobberGraphQLMutation("mutation { noop }", {}, {
    getAccessToken: () => Promise.resolve(null),
    fetch: (() => {
      calls += 1;
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch,
  });

  assertEquals(calls, 0);
  assertEquals(result.outcomeUncertain, undefined);
  assertEquals(result.errors?.[0]?.message, "No valid Jobber access token");
});

Deno.test("Jobber lines preserve canonical totals without duplicating embedded surcharges", () => {
  const lines = buildJobberBookingLineItems({
    services: [{ name: "Window Cleaning", price: 100 }],
    priceAdjustments: [
      {
        label: "Solar-screen service",
        kind: "surcharge",
        amount: 20,
      },
      {
        label: "No-screen discount",
        kind: "discount",
        amount: 10,
      },
    ],
    discountAmount: 5,
    discountCode: "SAVE5",
  });
  assertEquals(lines.map((line) => line.name), [
    "Window Cleaning",
    "No-screen discount",
    "Discount (SAVE5)",
  ]);
  assertEquals(jobberBookingLineItemsTotal(lines), 85);
});
