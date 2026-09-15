"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft, ArrowUpRight, CalendarClock, Check, ChevronDown, CircleDollarSign,
  Copy, FileText, Home, LayoutDashboard, LogOut, Plus, Receipt, RefreshCw, Repeat2,
  Search, Settings, Sparkles, Trash2, Users, WalletCards, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";

type Member = { id:number; user_id:string; display_name:string; role:string };
type Expense = { id:string; description:string; category:string; amount_cents:number; paid_by_member_id:number; expense_date:string; split_type:string; notes:string; receipt_key:string|null; payer_name:string };
type Balance = { memberId:number; name:string; amountCents:number; isCurrentUser:boolean };
type Suggestion = { fromMemberId:number; fromName:string; toMemberId:number; toName:string; amountCents:number };
type Recurring = { id:string; description:string; category:string; amount_cents:number; paid_by_member_id:number; payer_name:string; cadence:string; next_due_date:string; participant_ids:string };
type ActiveData = {
  household:{id:string;name:string;currency:string;invite_code:string;owner_id:string}; currentMemberId:number;
  members:Member[]; expenses:Expense[]; settlements:Array<Record<string,string|number>>; recurring:Recurring[];
  balances:Balance[]; suggestedSettlements:Suggestion[]; selectedMonth:string; monthlyExpenses:Expense[]; monthTotalCents:number; categories:Array<{name:string;amountCents:number}>;
};
type AppData = { households:Array<{id:string;name:string;currency:string;invite_code:string;role:string}>; active:ActiveData|null };

const categories = ["Groceries", "Electricity", "Gas", "Internet", "Cleaning", "Household", "Maintenance", "Transport", "Other"];
const categoryIcons:Record<string,string> = { Groceries:"◒", Electricity:"ϟ", Gas:"◉", Internet:"⌁", Cleaning:"✦", Household:"□", Maintenance:"◇", Transport:"→", Other:"•" };
const today = () => new Date().toISOString().slice(0, 10);
const displayDate = (date:string) => new Intl.DateTimeFormat("en", { day:"numeric", month:"short" }).format(new Date(`${date}T12:00:00`));
const initials = (name:string) => name.split(/\s|@/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join("");
const formatMoney = (cents:number, currency="BDT") => currency === "BDT" ? `৳${Math.abs(cents / 100).toLocaleString("en-BD", { maximumFractionDigits:2 })}` : new Intl.NumberFormat("en", { style:"currency", currency }).format(Math.abs(cents / 100));

async function api(body?:Record<string,unknown>, householdId?:string, month?:string): Promise<any> {
  const query = new URLSearchParams();
  if (householdId) query.set("householdId", householdId);
  if (month) query.set("month", month);
  const response = await fetch(body ? "/api/app" : `/api/app${query.size ? `?${query}` : ""}`, body ? { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) } : undefined);
  const result = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(result.error || "Something went wrong");
  return result;
}

export default function MohaNagorikApp({ user }:{ user:{name:string;email:string} }) {
  const [data, setData] = useState<AppData|null>(null);
  const [activeId, setActiveId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion|null>(null);

  const load = useCallback(async (id?:string, month = selectedMonth) => {
    try {
      setLoading(true);
      const result = await api(undefined, id || activeId, month);
      setData(result);
      if (result.active?.household?.id) setActiveId(result.active.household.id);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load"); }
    finally { setLoading(false); }
  }, [activeId, selectedMonth]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (body:Record<string,unknown>, message:string) => {
    try { const result = await api({ ...body, householdId:activeId }); toast.success(message); await load(result.householdId || activeId); return result; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save"); throw error; }
  };

  useEffect(() => {
    const context = typeof document === "undefined" ? undefined : (document as Document & {modelContext?:{registerTool:(tool:unknown, options?:unknown)=>void|Promise<void>}}).modelContext;
    if (!context?.registerTool || !data?.active) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name:"add_shared_expense", title:"Add shared expense", description:"Add an equally split expense to the currently selected MohaNagorik household.",
      inputSchema:{ type:"object", properties:{ description:{type:"string"}, amount:{type:"number"}, category:{type:"string"} }, required:["description","amount"], additionalProperties:false },
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute:async (input:unknown) => {
        const value = input as {description:string;amount:number;category?:string};
        const active = data.active!;
        await api({ action:"create_expense", householdId:active.household.id, description:value.description, amount:value.amount, category:value.category || "Other", expenseDate:today(), paidByMemberId:active.currentMemberId, splitType:"equal", participantIds:active.members.map((m) => Number(m.id)), notes:"Added by assistant" });
        await load(active.household.id);
        return {status:"created",description:value.description,amount:value.amount};
      }
    }, {signal:lifecycle.signal})).catch(() => undefined);
    return () => lifecycle.abort();
  }, [data?.active?.household.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <LoadingScreen />;
  if (!data?.active) return <Onboarding user={user} onDone={(id) => { setActiveId(id); void load(id); }} />;

  const active = data.active;
  const currentBalance = active.balances.find((b) => b.isCurrentUser)?.amountCents ?? 0;
  const filteredExpenses = active.expenses.filter((e) => `${e.description} ${e.category} ${e.payer_name}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark small">M</div><span>MohaNagorik</span></div>
        <button className="household-switch" onClick={() => data.households.length > 1 && setTab("households")}>
          <div><small>HOUSEHOLD</small><strong>{active.household.name}</strong></div><ChevronDown size={16}/>
        </button>
        <nav className="side-nav" aria-label="Main navigation">
          <NavButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<LayoutDashboard/>}>Overview</NavButton>
          <NavButton active={tab === "expenses"} onClick={() => setTab("expenses")} icon={<Receipt/>}>Expenses</NavButton>
          <NavButton active={tab === "settlements"} onClick={() => setTab("settlements")} icon={<WalletCards/>}>Settle up</NavButton>
          <NavButton active={tab === "recurring"} onClick={() => setTab("recurring")} icon={<Repeat2/>}>Recurring</NavButton>
          <NavButton active={tab === "people"} onClick={() => setTab("people")} icon={<Users/>}>People</NavButton>
        </nav>
        <div className="sidebar-footer">
          <div className="profile-avatar">{initials(user.name)}</div>
          <div className="profile-copy"><strong>{user.name.split("@")[0]}</strong><span>{user.email}</span></div>
          <a className="icon-link" aria-label="Sign out" href="/api/auth/logout"><LogOut size={17}/></a>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p>{new Intl.DateTimeFormat("en", {month:"long", year:"numeric"}).format(new Date(`${selectedMonth}-01T12:00:00`))}</p><h1>{tab === "overview" ? "Good to see you" : tab[0].toUpperCase() + tab.slice(1)}</h1></div>
          <div className="top-actions">
            <label className="month-filter"><span>Month</span><Input type="month" value={selectedMonth} max={today().slice(0,7)} onChange={(event)=>{const month=event.target.value;if(month){setSelectedMonth(month);void load(activeId,month);}}}/></label>
            <Button variant="outline" className="settle-button" onClick={() => setSettleOpen(true)}><CircleDollarSign/> Settle up</Button>
            <Button className="add-button" onClick={() => setExpenseOpen(true)}><Plus/> Add expense</Button>
          </div>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="content-tabs">
          <TabsList className="mobile-tabs" variant="line">
            <TabsTrigger value="overview"><Home/>Home</TabsTrigger><TabsTrigger value="expenses"><Receipt/>Expenses</TabsTrigger>
            <TabsTrigger value="settlements"><WalletCards/>Settle</TabsTrigger><TabsTrigger value="recurring"><Repeat2/>Bills</TabsTrigger><TabsTrigger value="people"><Users/>People</TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><Overview active={active} balance={currentBalance} onExpense={() => setExpenseOpen(true)} onSettle={(s) => {setSelectedSuggestion(s);setSettleOpen(true);}} /></TabsContent>
          <TabsContent value="expenses"><ExpensesView active={active} expenses={filteredExpenses} search={search} setSearch={setSearch} onVoid={(id) => run({action:"void_expense",expenseId:id},"Expense removed")} /></TabsContent>
          <TabsContent value="settlements"><SettlementsView active={active} onSettle={(s) => {setSelectedSuggestion(s);setSettleOpen(true);}} /></TabsContent>
          <TabsContent value="recurring"><RecurringView active={active} onAdd={() => setRecurringOpen(true)} onPost={(id) => run({action:"post_recurring",recurringId:id},"Bill added to expenses")} /></TabsContent>
          <TabsContent value="people"><PeopleView active={active} /></TabsContent>
          <TabsContent value="households"><HouseholdsView data={data} activeId={activeId} onSwitch={(id) => {setTab("overview");void load(id);}} onCreate={async(name,currency)=>{const r=await run({action:"create_household",name,currency},"Household created");setTab("overview");void load(r.householdId);}} onJoin={async(inviteCode)=>{const r=await run({action:"join_household",inviteCode},"Household joined");setTab("overview");void load(r.householdId);}} /></TabsContent>
        </Tabs>
      </section>

      <ExpenseDialog open={expenseOpen} onOpenChange={setExpenseOpen} active={active} onSave={async (payload, file) => {
        const result = await run({action:"create_expense",...payload},"Expense added");
        if (file && result.expenseId) { const form = new FormData(); form.set("expenseId", result.expenseId); form.set("file", file); const upload = await fetch("/api/receipts", {method:"POST",body:form}); if (!upload.ok) toast.warning("Expense saved, but the receipt could not be uploaded"); else await load(activeId); }
        setExpenseOpen(false);
      }}/>
      <SettlementDialog open={settleOpen} onOpenChange={(value) => {setSettleOpen(value);if(!value)setSelectedSuggestion(null);}} active={active} suggestion={selectedSuggestion} onSave={async (payload) => {await run({action:"create_settlement",...payload},"Settlement recorded");setSettleOpen(false);setSelectedSuggestion(null);}} />
      <RecurringDialog open={recurringOpen} onOpenChange={setRecurringOpen} active={active} onSave={async (payload) => {await run({action:"create_recurring",...payload},"Recurring bill created");setRecurringOpen(false);}} />
      <Toaster position="top-center" richColors />
    </main>
  );
}

function LoadingScreen() { return <div className="loading-screen"><div className="brand-mark">M</div><RefreshCw className="spin"/><span>Opening your household…</span></div>; }

function Onboarding({user,onDone}:{user:{name:string;email:string};onDone:(id:string)=>void}) {
  const [mode,setMode] = useState<"create"|"join">("create"); const [name,setName]=useState(""); const [code,setCode]=useState(""); const [currency,setCurrency]=useState("BDT"); const [busy,setBusy]=useState(false);
  const submit = async () => { try { setBusy(true); const result = await api(mode === "create" ? {action:"create_household",name,currency} : {action:"join_household",inviteCode:code}); toast.success(mode === "create" ? "Your household is ready" : "Welcome home"); onDone(result.householdId); } catch(error){toast.error(error instanceof Error?error.message:"Unable to continue");} finally{setBusy(false);} };
  return <main className="onboarding-shell"><section className="onboarding-card"><div className="brand"><div className="brand-mark small">M</div><span>MohaNagorik</span></div><div className="welcome-icon"><Home/></div><p className="eyebrow">Welcome, {user.name.split(" ")[0].split("@")[0]}</p><h1>{mode === "create" ? "Let’s set up your household" : "Join your household"}</h1><p>{mode === "create" ? "Give your shared space a name. You can invite everyone else next." : "Enter the invite code shared by someone in your household."}</p><div className="mode-tabs"><button className={mode === "create"?"active":""} onClick={()=>setMode("create")}>Create new</button><button className={mode === "join"?"active":""} onClick={()=>setMode("join")}>Join with code</button></div>{mode === "create" ? <div className="onboarding-fields"><label>Household name<Input value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g. Banani Flat" autoFocus/></label><label>Currency<Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["BDT","USD","GBP","EUR","INR"].map((c)=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></label></div> : <label>Invite code<Input value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="8-character code" autoFocus/></label>}<Button className="wide-button" disabled={busy || (mode === "create" ? name.length < 2 : code.length < 6)} onClick={submit}>{busy?<RefreshCw className="spin"/>:<ArrowUpRight/>}{mode === "create" ? "Create household" : "Join household"}</Button></section><Toaster position="top-center" richColors/></main>;
}

function NavButton({active,onClick,icon,children}:{active:boolean;onClick:()=>void;icon:React.ReactNode;children:React.ReactNode}) { return <button className={active?"active":""} onClick={onClick}>{icon}<span>{children}</span></button>; }

function Overview({active,balance,onExpense,onSettle}:{active:ActiveData;balance:number;onExpense:()=>void;onSettle:(s:Suggestion)=>void}) {
  const maxCategory = Math.max(...active.categories.map((c)=>c.amountCents),1);
  const monthLabel = new Intl.DateTimeFormat("en", {month:"long",year:"numeric"}).format(new Date(`${active.selectedMonth}-01T12:00:00`));
  return <div className="overview-grid"><section className="main-column"><div className={`balance-card ${balance < 0 ? "negative":""}`}><div className="balance-top"><div><p>Your balance</p><strong>{formatMoney(balance,active.household.currency)}</strong><span>{Math.abs(balance)<2?"all settled":balance>0?"you are owed":"you owe"}</span></div><div className="balance-orbit"><span>{balance>=0?<ArrowDownLeft/>:<ArrowUpRight/>}</span></div></div><div className="balance-actions"><button onClick={onExpense}><Plus/>Add an expense</button><button onClick={()=>active.suggestedSettlements[0]&&onSettle(active.suggestedSettlements[0])}><Check/>Record payment</button></div></div>
  <div className="section-heading"><div><h2>{monthLabel} activity</h2><p>{active.monthlyExpenses.length} recorded expenses</p></div></div><div className="activity-card">{active.monthlyExpenses.length ? active.monthlyExpenses.slice(0,5).map((expense)=><ExpenseRow key={expense.id} expense={expense} currency={active.household.currency}/>) : <EmptyState icon={<Receipt/>} title="No expenses this month" copy={`Add an expense dated in ${monthLabel} to see it here.`} action={onExpense}/>}</div></section>
  <aside className="insight-column"><div className="summary-card"><div className="section-heading"><div><h2>{monthLabel}</h2><p>Total household spending</p></div><strong>{formatMoney(active.monthTotalCents,active.household.currency)}</strong></div><div className="category-bars">{active.categories.length?active.categories.slice(0,5).map((category)=><div key={category.name}><div><span>{category.name}</span><b>{formatMoney(category.amountCents,active.household.currency)}</b></div><i><em style={{width:`${Math.max(5,category.amountCents/maxCategory*100)}%`}}/></i></div>):<p className="muted">Categories appear after your first expense.</p>}</div></div>
  <div className="settle-card"><div className="settle-title"><span><Sparkles/></span><div><h2>Simplest settle-up</h2><p>{active.suggestedSettlements.length?`${active.suggestedSettlements.length} payment${active.suggestedSettlements.length===1?"":"s"} clears the group`:"Nothing to settle"}</p></div></div>{active.suggestedSettlements.slice(0,3).map((s)=><button key={`${s.fromMemberId}-${s.toMemberId}`} onClick={()=>onSettle(s)}><div className="avatar-stack"><span>{initials(s.fromName)}</span><ArrowUpRight/><span>{initials(s.toName)}</span></div><div><b>{s.fromName.split(" ")[0]} → {s.toName.split(" ")[0]}</b><small>{formatMoney(s.amountCents,active.household.currency)}</small></div><ChevronDown className="rotate"/></button>)}</div></aside></div>;
}

function ExpenseRow({expense,currency,onVoid}:{expense:Expense;currency:string;onVoid?:(id:string)=>void}) { return <article className="expense-row"><div className={`category-icon cat-${expense.category.toLowerCase()}`}>{categoryIcons[expense.category]||"•"}</div><div className="expense-main"><strong>{expense.description}</strong><span>{expense.category} · Paid by {expense.payer_name}</span></div><div className="expense-date">{displayDate(expense.expense_date)}</div>{expense.receipt_key&&<a className="receipt-link" aria-label="View receipt" href={`/api/receipts?expenseId=${expense.id}`} target="_blank"><FileText/></a>}<div className="expense-amount"><strong>{formatMoney(expense.amount_cents,currency)}</strong><span>{expense.split_type} split</span></div>{onVoid&&<button className="row-delete" aria-label={`Remove ${expense.description}`} onClick={()=>onVoid(expense.id)}><Trash2/></button>}</article>; }

function ExpensesView({active,expenses,search,setSearch,onVoid}:{active:ActiveData;expenses:Expense[];search:string;setSearch:(v:string)=>void;onVoid:(id:string)=>void}) { return <section className="page-card"><div className="toolbar"><div className="search-box"><Search/><Input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search expenses"/></div><div className="count-pill">{expenses.length} expenses</div></div><div className="expense-list">{expenses.map((e)=><ExpenseRow key={e.id} expense={e} currency={active.household.currency} onVoid={onVoid}/>)}{!expenses.length&&<EmptyState icon={<Search/>} title="No matching expenses" copy="Try another description, category, or payer."/>}</div></section>; }

function SettlementsView({active,onSettle}:{active:ActiveData;onSettle:(s:Suggestion)=>void}) { return <div className="two-column"><section className="page-card"><div className="section-heading"><div><h2>Recommended payments</h2><p>The fewest transfers needed to clear all balances.</p></div></div><div className="recommendations">{active.suggestedSettlements.length?active.suggestedSettlements.map((s)=><article key={`${s.fromMemberId}-${s.toMemberId}`}><div className="payment-flow"><span>{initials(s.fromName)}</span><div><i/><small>pays</small></div><span>{initials(s.toName)}</span></div><div className="payment-names"><b>{s.fromName}</b><small>to {s.toName}</small></div><strong>{formatMoney(s.amountCents,active.household.currency)}</strong><Button size="sm" onClick={()=>onSettle(s)}>Record</Button></article>):<EmptyState icon={<Check/>} title="Everyone is settled" copy="There are no outstanding balances right now."/>}</div></section><aside className="page-card"><div className="section-heading"><div><h2>Member balances</h2><p>After all expenses and payments</p></div></div><div className="balance-list">{active.balances.map((b)=><div key={b.memberId}><span className="member-avatar">{initials(b.name)}</span><div><b>{b.name}{b.isCurrentUser?" (you)":""}</b><small>{Math.abs(b.amountCents)<2?"settled":b.amountCents>0?"gets back":"owes"}</small></div><strong className={b.amountCents<0?"owes":"gets"}>{formatMoney(b.amountCents,active.household.currency)}</strong></div>)}</div></aside></div>; }

function RecurringView({active,onAdd,onPost}:{active:ActiveData;onAdd:()=>void;onPost:(id:string)=>void}) { return <section className="page-card"><div className="section-heading recurring-head"><div><h2>Recurring bills</h2><p>Keep regular utilities and subscriptions ready to post.</p></div><Button onClick={onAdd}><Plus/>New recurring bill</Button></div><div className="recurring-grid">{active.recurring.map((r)=><article key={r.id}><div className="recurring-icon"><CalendarClock/></div><div className="recurring-copy"><span>{r.category}</span><h3>{r.description}</h3><p>Paid by {r.payer_name} · {r.cadence}</p></div><strong>{formatMoney(r.amount_cents,active.household.currency)}</strong><div className="due-line"><span>Next due {displayDate(r.next_due_date)}</span><Button variant="outline" size="sm" onClick={()=>onPost(r.id)}>Post now</Button></div></article>)}{!active.recurring.length&&<EmptyState icon={<Repeat2/>} title="No recurring bills" copy="Save utilities or subscriptions so they are ready each month." action={onAdd}/>}</div></section>; }

function PeopleView({active}:{active:ActiveData}) { const copy = async()=>{await navigator.clipboard.writeText(active.household.invite_code);toast.success("Invite code copied");}; return <div className="two-column"><section className="page-card"><div className="section-heading"><div><h2>People in {active.household.name}</h2><p>{active.members.length} active member{active.members.length===1?"":"s"}</p></div></div><div className="people-list">{active.members.map((m)=><div key={m.id}><span className="member-avatar large">{initials(m.display_name)}</span><div><b>{m.display_name}</b><small>{m.role === "owner"?"Household owner":"Member"}</small></div>{m.role === "owner"&&<span className="role-pill">Owner</span>}</div>)}</div></section><aside className="invite-card"><div className="invite-icon"><Users/></div><p className="eyebrow">Invite your housemates</p><h2>One code. Everyone in.</h2><p>Share this private code. New members can join after signing in.</p><button className="code-box" onClick={copy}><b>{active.household.invite_code}</b><Copy/></button><small>Only share it with people you trust.</small></aside></div>; }

function HouseholdsView({data,activeId,onSwitch,onCreate,onJoin}:{data:AppData;activeId:string;onSwitch:(id:string)=>void;onCreate:(name:string,currency:string)=>Promise<void>;onJoin:(code:string)=>Promise<void>}) { const[name,setName]=useState("");const[code,setCode]=useState("");const[currency,setCurrency]=useState("BDT");return <div className="two-column"><section className="page-card"><div className="section-heading"><div><h2>Your households</h2><p>Switch between the spaces you share.</p></div></div><div className="household-grid">{data.households.map((h)=><button key={h.id} className={h.id===activeId?"active":""} onClick={()=>onSwitch(h.id)}><Home/><div><b>{h.name}</b><span>{h.role}</span></div>{h.id===activeId&&<Check/>}</button>)}</div></section><aside className="page-card household-actions"><h2>Add another household</h2><Field label="New household name"><Input value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g. Office lunch group"/></Field><Field label="Currency"><Select value={currency} onValueChange={setCurrency}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["BDT","USD","GBP","EUR","INR"].map((c)=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field><Button disabled={name.length<2} onClick={()=>onCreate(name,currency)}><Plus/>Create</Button><div className="or-line"><span>or join with a code</span></div><div className="join-row"><Input value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="Invite code"/><Button variant="outline" disabled={code.length<6} onClick={()=>onJoin(code)}>Join</Button></div></aside></div>; }

function EmptyState({icon,title,copy,action}:{icon:React.ReactNode;title:string;copy:string;action?:()=>void}) { return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{copy}</p>{action&&<Button variant="outline" size="sm" onClick={action}><Plus/>Add now</Button>}</div>; }

function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="form-field"><span>{label}</span>{children}</label>; }

function ExpenseDialog({open,onOpenChange,active,onSave}:{open:boolean;onOpenChange:(v:boolean)=>void;active:ActiveData;onSave:(p:Record<string,unknown>,f:File|null)=>Promise<void>}) {
  const [description,setDescription]=useState(""); const [amount,setAmount]=useState(""); const [category,setCategory]=useState("Groceries"); const [date,setDate]=useState(today()); const [payer,setPayer]=useState(String(active.currentMemberId)); const [splitType,setSplitType]=useState("equal"); const [participants,setParticipants]=useState<number[]>(active.members.map((m)=>Number(m.id))); const [shares,setShares]=useState<Record<string,string>>({}); const [notes,setNotes]=useState(""); const [file,setFile]=useState<File|null>(null); const [busy,setBusy]=useState(false);
  useEffect(()=>{if(open){setParticipants(active.members.map((m)=>Number(m.id)));setPayer(String(active.currentMemberId));}},[open,active]);
  const customTotal=Object.values(shares).reduce((s,v)=>s+(Number(v)||0),0); const valid=description.trim()&&Number(amount)>0&&participants.length>0&&(splitType==="equal"||Math.abs(customTotal-Number(amount))<0.001);
  const submit=async()=>{try{setBusy(true);await onSave({description,amount:Number(amount),category,expenseDate:date,paidByMemberId:Number(payer),splitType,participantIds:participants,customShares:shares,notes},file);setDescription("");setAmount("");setNotes("");setFile(null);}finally{setBusy(false);}};
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Add an expense</DialogTitle><DialogDescription>Record who paid and exactly how the cost should be shared.</DialogDescription></DialogHeader><div className="form-grid"><Field label="Description"><Input value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="Weekly groceries" autoFocus/></Field><Field label="Amount"><div className="money-input"><span>{active.household.currency==="BDT"?"৳":active.household.currency}</span><Input type="number" min="0" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="0.00"/></div></Field><Field label="Category"><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{categories.map((c)=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field><Field label="Date"><Input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></Field><Field label="Paid by"><Select value={payer} onValueChange={setPayer}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{active.members.map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field><Field label="Split method"><Select value={splitType} onValueChange={setSplitType}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="equal">Split equally</SelectItem><SelectItem value="custom">Exact amounts</SelectItem></SelectContent></Select></Field></div><div className="participants"><div><span>Split between</span><small>{participants.length} selected</small></div>{active.members.map((m)=>{const checked=participants.includes(Number(m.id));return <div className="participant-row" key={m.id}><Checkbox checked={checked} onCheckedChange={()=>setParticipants(checked?participants.filter((id)=>id!==Number(m.id)):[...participants,Number(m.id)])}/><span className="member-avatar tiny">{initials(m.display_name)}</span><b>{m.display_name}</b>{splitType==="custom"&&checked?<div className="share-input"><span>{active.household.currency==="BDT"?"৳":""}</span><Input type="number" step="0.01" value={shares[String(m.id)]||""} onChange={(e)=>setShares({...shares,[String(m.id)]:e.target.value})}/></div>:checked&&<small>{amount?formatMoney(Math.round(Number(amount)*100/participants.length),active.household.currency):"—"}</small>}</div>})}{splitType==="custom"&&<div className={`split-check ${Math.abs(customTotal-Number(amount))<0.001?"ok":""}`}><span>Assigned {formatMoney(Math.round(customTotal*100),active.household.currency)}</span><b>{Math.abs(customTotal-Number(amount))<0.001?"Balanced":`${formatMoney(Math.round(Math.abs(Number(amount)-customTotal)*100),active.household.currency)} remaining`}</b></div>}</div><Field label="Notes (optional)"><Input value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Anything your housemates should know"/></Field><Field label="Receipt (optional)"><Input type="file" accept="image/*,.pdf" onChange={(e)=>setFile(e.target.files?.[0]||null)}/></Field><Button className="wide-button" disabled={!valid||busy} onClick={submit}>{busy?<RefreshCw className="spin"/>:<Plus/>}Add expense</Button></DialogContent></Dialog>;
}

function SettlementDialog({open,onOpenChange,active,suggestion,onSave}:{open:boolean;onOpenChange:(v:boolean)=>void;active:ActiveData;suggestion:Suggestion|null;onSave:(p:Record<string,unknown>)=>Promise<void>}) { const [from,setFrom]=useState(String(active.currentMemberId));const [to,setTo]=useState("");const [amount,setAmount]=useState("");const [date,setDate]=useState(today());const [notes,setNotes]=useState("");const [busy,setBusy]=useState(false);useEffect(()=>{if(suggestion){setFrom(String(suggestion.fromMemberId));setTo(String(suggestion.toMemberId));setAmount(String(suggestion.amountCents/100));}},[suggestion]);const submit=async()=>{try{setBusy(true);await onSave({fromMemberId:Number(from),toMemberId:Number(to),amount:Number(amount),settlementDate:date,notes});}finally{setBusy(false);}};return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog compact"><DialogHeader><DialogTitle>Record a payment</DialogTitle><DialogDescription>This reduces the outstanding balance between two members.</DialogDescription></DialogHeader><div className="payment-form"><Field label="Paid by"><Select value={from} onValueChange={setFrom}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{active.members.map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field><ArrowUpRight/><Field label="Paid to"><Select value={to} onValueChange={setTo}><SelectTrigger><SelectValue placeholder="Choose member"/></SelectTrigger><SelectContent>{active.members.filter((m)=>String(m.id)!==from).map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="Amount"><div className="money-input"><span>{active.household.currency==="BDT"?"৳":active.household.currency}</span><Input type="number" min="0" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)}/></div></Field><Field label="Payment date"><Input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></Field><Field label="Note (optional)"><Input value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Bank transfer, cash…"/></Field><Button className="wide-button" disabled={!from||!to||Number(amount)<=0||busy} onClick={submit}>{busy?<RefreshCw className="spin"/>:<Check/>}Record settlement</Button></DialogContent></Dialog>; }

function RecurringDialog({open,onOpenChange,active,onSave}:{open:boolean;onOpenChange:(v:boolean)=>void;active:ActiveData;onSave:(p:Record<string,unknown>)=>Promise<void>}) { const [description,setDescription]=useState("");const [amount,setAmount]=useState("");const [category,setCategory]=useState("Groceries");const [payer,setPayer]=useState(String(active.currentMemberId));const [cadence,setCadence]=useState("monthly");const [due,setDue]=useState(today());const [participants,setParticipants]=useState<number[]>(active.members.map((m)=>Number(m.id)));const [busy,setBusy]=useState(false);const submit=async()=>{try{setBusy(true);await onSave({description,amount:Number(amount),category,paidByMemberId:Number(payer),cadence,nextDueDate:due,participantIds:participants});setDescription("");setAmount("");}finally{setBusy(false);}};return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>New recurring bill</DialogTitle><DialogDescription>Save the template, then post it whenever the bill is due.</DialogDescription></DialogHeader><div className="form-grid"><Field label="Bill name"><Input value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="Monthly internet"/></Field><Field label="Expected amount"><div className="money-input"><span>{active.household.currency==="BDT"?"৳":active.household.currency}</span><Input type="number" value={amount} onChange={(e)=>setAmount(e.target.value)}/></div></Field><Field label="Category"><Select value={category} onValueChange={setCategory}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{categories.map((c)=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field><Field label="Paid by"><Select value={payer} onValueChange={setPayer}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{active.members.map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field><Field label="Frequency"><Select value={cadence} onValueChange={setCadence}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Every 3 months</SelectItem></SelectContent></Select></Field><Field label="Next due"><Input type="date" value={due} onChange={(e)=>setDue(e.target.value)}/></Field></div><div className="participants"><div><span>Shared by</span><small>{participants.length} selected</small></div>{active.members.map((m)=>{const checked=participants.includes(Number(m.id));return <div className="participant-row" key={m.id}><Checkbox checked={checked} onCheckedChange={()=>setParticipants(checked?participants.filter((id)=>id!==Number(m.id)):[...participants,Number(m.id)])}/><span className="member-avatar tiny">{initials(m.display_name)}</span><b>{m.display_name}</b></div>})}</div><Button className="wide-button" disabled={!description||Number(amount)<=0||!participants.length||busy} onClick={submit}>{busy?<RefreshCw className="spin"/>:<Repeat2/>}Save recurring bill</Button></DialogContent></Dialog>; }
