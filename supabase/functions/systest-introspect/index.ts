import { jobberGraphQL } from "../_shared/jobberClient.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };

const INTROSPECT = `
query {
  __type(name: "Mutation") {
    fields(includeDeprecated: true) {
      name
      args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
      type { name kind ofType { name kind } }
    }
  }
}`;

const PAYLOAD = `
query($n: String!) {
  __type(name: $n) {
    name
    fields(includeDeprecated: true) { name type { kind name ofType { kind name } } }
  }
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const url = new URL(req.url);
  const typeName = url.searchParams.get("type");
  if (typeName) {
    const r = await jobberGraphQL(PAYLOAD, { n: typeName });
    return new Response(JSON.stringify(r), { headers: { ...cors, "Content-Type": "application/json" } });
  }
  const r = await jobberGraphQL<{ __type: { fields: Array<{ name: string }> } }>(INTROSPECT);
  const fields = (r.data?.__type?.fields || []).filter((f) => /visit/i.test(f.name));
  return new Response(JSON.stringify({ throttled: r.throttled, errors: r.errors, visitMutations: fields }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
});
