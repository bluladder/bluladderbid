import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useIsAdmin, useAuth } from "@/hooks/useAuth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Check, LogOut, Search, Save, ShieldX } from "lucide-react";
import { toast } from "sonner";

type KnowledgeRow = {
  id: string;
  knowledge_key: string;
  record_number: number | null;
  category: string;
  title: string;
  question: string | null;
  content: string;
  voice_answer: string | null;
  internal_policy: string | null;
  sales_guidance: string | null;
  tags: string[] | null;
  owner_notes: string | null;
  review_status: string;
  confidence: string | null;
  requires_owner_review: boolean | null;
  is_active: boolean;
};

export default function KnowledgeBaseAdmin() {
  const { isAdmin, loading, user } = useIsAdmin();
  const { signOut } = useAuth();
  const [rows, setRows] = useState<KnowledgeRow[]>([]);
  const [selected, setSelected] = useState<KnowledgeRow | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");
  const [saving, setSaving] = useState(false);
  const [loadingRows, setLoadingRows] = useState(true);

  const loadRows = async () => {
    setLoadingRows(true);
    const { data, error } = await supabase
      .from("business_knowledge")
      .select("id,knowledge_key,record_number,category,title,question,content,voice_answer,internal_policy,sales_guidance,tags,owner_notes,review_status,confidence,requires_owner_review,is_active")
      .order("sort_order", { ascending: true })
      .limit(1000);
    if (error) toast.error(error.message);
    setRows((data ?? []) as KnowledgeRow[]);
    setLoadingRows(false);
  };

  useEffect(() => { if (isAdmin) void loadRows(); }, [isAdmin]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.review_status !== status) return false;
      if (category !== "all" && r.category !== category) return false;
      if (!q) return true;
      return [r.record_number, r.knowledge_key, r.title, r.question, r.content, ...(r.tags ?? [])]
        .join(" ").toLowerCase().includes(q);
    });
  }, [rows, query, status, category]);

  const save = async (publish = false) => {
    if (!selected) return;
    setSaving(true);
    const patch = {
      category: selected.category,
      title: selected.title,
      question: selected.question,
      content: selected.content,
      voice_answer: selected.voice_answer,
      internal_policy: selected.internal_policy,
      sales_guidance: selected.sales_guidance,
      tags: selected.tags ?? [],
      owner_notes: selected.owner_notes,
      confidence: selected.confidence ?? "medium",
      review_status: publish ? "published" : selected.review_status,
      requires_owner_review: publish ? false : selected.requires_owner_review,
      is_active: publish ? true : selected.is_active,
      published_at: publish ? new Date().toISOString() : undefined,
      updated_by: user?.id,
    };
    const { error } = await supabase.from("business_knowledge").update(patch).eq("id", selected.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(publish ? "Record published" : "Draft saved");
    await loadRows();
    setSelected((current) => current ? { ...current, ...patch } as KnowledgeRow : current);
  };

  if (!user && !loading) return <AdminLogin />;
  if (loading) return <div className="min-h-screen grid place-items-center">Checking access…</div>;
  if (!isAdmin) return (
    <div className="min-h-screen grid place-items-center p-4">
      <Card><CardHeader><ShieldX className="h-10 w-10 text-destructive" /><CardTitle>Access denied</CardTitle></CardHeader></Card>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="container flex items-center justify-between py-4">
          <div>
            <h1 className="text-xl font-bold text-primary">BluLadder Knowledge Base</h1>
            <p className="text-xs text-muted-foreground">Draft, review, publish, and correct the AI agent's canonical facts.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/admin"><ArrowLeft className="mr-2 h-4 w-4" />Admin</Link></Button>
            <Button variant="ghost" onClick={() => signOut()}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
          </div>
        </div>
      </header>

      <main className="container py-6">
        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <Card className="h-[calc(100vh-130px)] overflow-hidden">
            <CardHeader className="space-y-3">
              <CardTitle className="flex items-center justify-between"><span>Records</span><Badge variant="secondary">{filtered.length}</Badge></CardTitle>
              <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search records…" className="pl-9" /></div>
              <div className="grid grid-cols-2 gap-2">
                <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="draft">Draft</SelectItem><SelectItem value="published">Published</SelectItem><SelectItem value="conflict">Conflict</SelectItem><SelectItem value="deprecated">Deprecated</SelectItem></SelectContent></Select>
                <Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
              </div>
            </CardHeader>
            <CardContent className="h-[calc(100%-165px)] overflow-y-auto space-y-2">
              {loadingRows ? <p className="text-sm text-muted-foreground">Loading…</p> : filtered.map((r) => (
                <button key={r.id} onClick={() => setSelected({ ...r })} className={`w-full rounded-md border p-3 text-left hover:bg-muted ${selected?.id === r.id ? "border-primary bg-muted" : ""}`}>
                  <div className="flex items-start justify-between gap-2"><span className="text-sm font-medium">{r.record_number ? `${r.record_number}. ` : ""}{r.title}</span><Badge variant={r.review_status === "published" ? "default" : "outline"}>{r.review_status}</Badge></div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.question || r.content}</p>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader><CardTitle>{selected ? `Edit ${selected.knowledge_key}` : "Select a record"}</CardTitle></CardHeader>
            {selected && <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2"><label className="space-y-1 text-sm">Title<Input value={selected.title} onChange={(e) => setSelected({ ...selected, title: e.target.value })} /></label><label className="space-y-1 text-sm">Category<Input value={selected.category} onChange={(e) => setSelected({ ...selected, category: e.target.value })} /></label></div>
              <label className="block space-y-1 text-sm">Question<Textarea value={selected.question ?? ""} onChange={(e) => setSelected({ ...selected, question: e.target.value })} /></label>
              <label className="block space-y-1 text-sm">Customer answer<Textarea rows={5} value={selected.content} onChange={(e) => setSelected({ ...selected, content: e.target.value })} /></label>
              <label className="block space-y-1 text-sm">Voice answer<Textarea rows={3} value={selected.voice_answer ?? ""} onChange={(e) => setSelected({ ...selected, voice_answer: e.target.value })} /></label>
              <label className="block space-y-1 text-sm">Internal policy<Textarea rows={3} value={selected.internal_policy ?? ""} onChange={(e) => setSelected({ ...selected, internal_policy: e.target.value })} /></label>
              <label className="block space-y-1 text-sm">Sales guidance<Textarea rows={3} value={selected.sales_guidance ?? ""} onChange={(e) => setSelected({ ...selected, sales_guidance: e.target.value })} /></label>
              <label className="block space-y-1 text-sm">Tags (comma separated)<Input value={(selected.tags ?? []).join(", ")} onChange={(e) => setSelected({ ...selected, tags: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
              <label className="block space-y-1 text-sm">Owner notes<Textarea rows={3} value={selected.owner_notes ?? ""} onChange={(e) => setSelected({ ...selected, owner_notes: e.target.value })} /></label>
              <div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={() => void save(false)}><Save className="mr-2 h-4 w-4" />Save draft</Button><Button disabled={saving || !selected.content.trim()} variant="secondary" onClick={() => void save(true)}><Check className="mr-2 h-4 w-4" />Publish and activate</Button></div>
              <p className="text-xs text-muted-foreground">Draft records are never supplied to the customer-facing AI. Publishing makes this record active immediately.</p>
            </CardContent>}
          </Card>
        </div>
      </main>
    </div>
  );
}
