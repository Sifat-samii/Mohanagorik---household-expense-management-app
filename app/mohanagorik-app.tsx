"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import NextImage from "next/image";
import {
  ArrowDownLeft, ArrowUpRight, BookOpen, CalendarClock, Camera, Check, ChevronDown, ChevronRight,
  CircleHelp, Copy, FileText, Home, LayoutDashboard, LogOut, Plus, Receipt, RefreshCw,
  Moon, Repeat2, Search, Settings, SlidersHorizontal, Sparkles, Trash2, TriangleAlert, UserPlus, Users, WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { BrandLogo } from "@/components/brand-logo";
import { EXPENSE_CATEGORIES, isCategoryApplicable, parseApplicableCategories } from "@/lib/categories";

type Member = { id:number; display_name:string; avatar_choice:string; avatar_key:string|null; applicable_categories:string|null };
type ExpenseSplit = { expense_id:string; member_id:number; share_cents:number };
type Expense = { id:string; description:string; category:string; amount_cents:number; paid_by_member_id:number; expense_date:string; split_type:string; notes:string; receipt_key:string|null; payer_name:string; splits:ExpenseSplit[] };
type Balance = { memberId:number; name:string; amountCents:number; isCurrentUser:boolean };
type Suggestion = { fromMemberId:number; fromName:string; toMemberId:number; toName:string; amountCents:number };
type Recurring = { id:string; description:string; category:string; amount_cents:number; paid_by_member_id:number; payer_name:string; cadence:string; next_due_date:string; participant_ids:string; last_posted_at:string|null };
type ActiveData = {
  household:{id:string;name:string;currency:string;invite_code:string}; currentMemberId:number;
  members:Member[]; expenses:Expense[]; settlements:Array<Record<string,string|number>>; recurring:Recurring[];
  balances:Balance[]; suggestedSettlements:Suggestion[]; selectedMonth:string; monthlyExpenses:Expense[]; monthTotalCents:number; categories:Array<{name:string;amountCents:number}>; memberSpending:Array<{memberId:number;name:string;amountCents:number;expenseAmountCents:number;settlementAmountCents:number}>;
};
type AppData = { households:Array<{id:string;name:string;currency:string;invite_code:string}>; active:ActiveData|null };
type MutationResult = { ok?:boolean; householdId?:string; expenseId?:string; deactivatedRecurringCount?:number; error?:string };

const categories:string[] = [...EXPENSE_CATEGORIES];
const categoryIcons:Record<string,string> = { Groceries:"◒", Electricity:"ϟ", Gas:"◉", Internet:"⌁", Cleaning:"✦", Household:"□", Maintenance:"◇", Transport:"→", Other:"•" };
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};
const displayDate = (date:string) => new Intl.DateTimeFormat("en", { day:"numeric", month:"short" }).format(new Date(`${date}T12:00:00`));
const displayFullDate = (date:string) => new Intl.DateTimeFormat("en", { day:"numeric", month:"long", year:"numeric" }).format(new Date(`${date}T12:00:00`));
const initials = (name:string) => name.split(/\s|@/).filter(Boolean).slice(0,2).map((part) => part[0]?.toUpperCase()).join("");
const formatMoney = (cents:number, currency="BDT") => currency === "BDT" ? `৳${Math.abs(cents / 100).toLocaleString("en-BD", { maximumFractionDigits:2 })}` : new Intl.NumberFormat("en", { style:"currency", currency }).format(Math.abs(cents / 100));
const formatSignedMoney = (cents:number, currency="BDT") => `${cents < 0 ? "−" : ""}${formatMoney(cents, currency)}`;
const memberCategories = (member:Member) => parseApplicableCategories(member.applicable_categories);
const eligibleMembers = (members:Member[], category:string) => members.filter((member)=>isCategoryApplicable(member.applicable_categories,category));
const themeKey="mohanagorik-theme";
const themeEvent="mohanagorik-theme-change";
const activeHouseholdKey=(email:string)=>`mohanagorik-active-household:${email.trim().toLowerCase()}`;
const readPreferredHousehold=(email:string)=>{
  if(typeof window==="undefined")return "";
  const householdFromUrl=new URLSearchParams(window.location.search).get("householdId")?.trim();
  if(householdFromUrl)return householdFromUrl;
  try{return localStorage.getItem(activeHouseholdKey(email))||"";}catch{return "";}
};
const rememberActiveHousehold=(householdId:string,email:string)=>{
  if(typeof window==="undefined")return;
  try{if(householdId)localStorage.setItem(activeHouseholdKey(email),householdId);else localStorage.removeItem(activeHouseholdKey(email));}catch{}
  const url=new URL(window.location.href);
  if(householdId)url.searchParams.set("householdId",householdId);else url.searchParams.delete("householdId");
  window.history.replaceState(window.history.state,"",`${url.pathname}${url.search}${url.hash}`);
};
const readDarkMode=()=>typeof document!=="undefined"&&document.documentElement.dataset.theme==="dark";
const subscribeTheme=(listener:()=>void)=>{const handleStorage=(event:StorageEvent)=>{if(event.key===themeKey){const dark=event.newValue==="dark";document.documentElement.dataset.theme=dark?"dark":"light";document.documentElement.classList.toggle("dark",dark);document.documentElement.style.colorScheme=dark?"dark":"light";listener();}};window.addEventListener("storage",handleStorage);window.addEventListener(themeEvent,listener);return()=>{window.removeEventListener("storage",handleStorage);window.removeEventListener(themeEvent,listener);};};
const changeTheme=(dark:boolean)=>{const theme=dark?"dark":"light";document.documentElement.dataset.theme=theme;document.documentElement.classList.toggle("dark",dark);document.documentElement.style.colorScheme=theme;try{localStorage.setItem(themeKey,theme);}catch{}const meta=document.querySelector('meta[name="theme-color"]');meta?.setAttribute("content",dark?"#0b1020":"#172554");window.dispatchEvent(new Event(themeEvent));};

function api(body:undefined, householdId?:string, month?:string):Promise<AppData>;
function api(body:Record<string,unknown>, householdId?:string, month?:string):Promise<MutationResult>;
async function api(body?:Record<string,unknown>, householdId?:string, month?:string):Promise<AppData|MutationResult> {
  const query = new URLSearchParams();
  if (householdId) query.set("householdId", householdId);
  if (month) query.set("month", month);
  const response = await fetch(body ? "/api/app" : `/api/app${query.size ? `?${query}` : ""}`, body ? { method:"POST", headers:{"Content-Type":"application/json","X-Client-Date":today()}, body:JSON.stringify(body) } : {headers:{"X-Client-Date":today()}});
  const result = await response.json() as AppData | MutationResult;
  if (!response.ok) throw new Error((result as MutationResult).error || "Something went wrong");
  return result;
}

export default function MohaNagorikApp({ user }:{ user:{name:string;email:string} }) {
  const [data, setData] = useState<AppData|null>(null);
  const [activeId, setActiveId] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(today().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("overview");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedSuggestion, setSelectedSuggestion] = useState<Suggestion|null>(null);
  const [householdCreationCooldownUntil,setHouseholdCreationCooldownUntil]=useState(0);
  const darkMode=useSyncExternalStore(subscribeTheme,readDarkMode,()=>false);

  const load = useCallback(async (id?:string, month = selectedMonth) => {
    try {
      setLoading(true);
      setLoadError("");
      const result = await api(undefined, id || activeId, month);
      setData(result);
      const resolvedHouseholdId=result.active?.household?.id||"";
      setActiveId(resolvedHouseholdId);
      rememberActiveHousehold(resolvedHouseholdId,user.email);
    } catch (error) { const message=error instanceof Error ? error.message : "Unable to load";if(!data)setLoadError(message);else toast.error(message); }
    finally { setLoading(false); }
  }, [activeId, selectedMonth, data, user.email]);

  // Initial remote state is intentionally loaded once when this client surface mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(readPreferredHousehold(user.email)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (body:Record<string,unknown>, message:string) => {
    try { const result = await api({ ...body, householdId:activeId }); toast.success(message); await load(result.householdId || activeId); return result; }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save"); throw error; }
  };

  const signOut = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method:"POST" });
      if (!response.ok) throw new Error("Unable to sign out");
      window.location.href = new URL("/", window.location.origin).toString();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to sign out");
    }
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
        const requestedCategory=value.category&&categories.includes(value.category)?value.category:"Other";
        const current=active.members.find((member)=>member.id===active.currentMemberId)!;
        const category=isCategoryApplicable(current.applicable_categories,requestedCategory)?requestedCategory:categories.find((item)=>isCategoryApplicable(current.applicable_categories,item))??"Other";
        const participants=eligibleMembers(active.members,category).map((m)=>Number(m.id));
        await api({ action:"create_expense", householdId:active.household.id, description:value.description, amount:value.amount, category, expenseDate:today(), paidByMemberId:active.currentMemberId, splitType:"equal", participantIds:participants, notes:"Added by assistant" });
        await load(active.household.id);
        return {status:"created",description:value.description,amount:value.amount};
      }
    }, {signal:lifecycle.signal})).catch(() => undefined);
    return () => lifecycle.abort();
  }, [data?.active?.household.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <LoadingScreen />;
  if (!data && loadError) return <LoadError message={loadError} onRetry={()=>void load()}/>;
  if (!data?.active) return <Onboarding user={user} darkMode={darkMode} onDone={(id) => { setActiveId(id); void load(id); }} />;

  const active = data.active;
  const currentMember = active.members.find((member) => member.id === active.currentMemberId);
  const currentBalance = active.balances.find((b) => b.isCurrentUser)?.amountCents ?? 0;
  const deleteHousehold = async (householdId:string) => {
    try {
      await api({action:"delete_household",householdId,confirmation:"delete"});
      const fallback=data.households.find((household)=>household.id!==householdId)?.id;
      const result=await api(undefined,fallback,selectedMonth);
      const resolvedHouseholdId=result.active?.household.id||"";
      setData(result);setActiveId(resolvedHouseholdId);rememberActiveHousehold(resolvedHouseholdId,user.email);setTab("overview");
      toast.success("Household deleted");
    } catch(error) { toast.error(error instanceof Error?error.message:"Unable to delete household");throw error; }
  };
  const leaveHousehold = async (householdId:string) => {
    try {
      const result=await api({action:"leave_household",householdId,confirmation:"leave"});
      const fallback=householdId===activeId?data.households.find((household)=>household.id!==householdId)?.id:activeId;
      const refreshed=await api(undefined,fallback,selectedMonth);
      const resolvedHouseholdId=refreshed.active?.household.id||"";
      setData(refreshed);setActiveId(resolvedHouseholdId);rememberActiveHousehold(resolvedHouseholdId,user.email);setTab(refreshed.active?"households":"overview");
      toast.success(result.deactivatedRecurringCount?`Household left. ${result.deactivatedRecurringCount} recurring bill${result.deactivatedRecurringCount===1?" was":"s were"} paused.`:"You left the household");
    } catch(error) { toast.error(error instanceof Error?error.message:"Unable to leave household");throw error; }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><BrandLogo size={34} priority/><span>MohaNagorik</span></div>
        <HouseholdSwitcher data={data} activeId={activeId} onSwitch={(id)=>{setTab("overview");void load(id);}} onManage={()=>setTab("households")}/>
        <nav className="side-nav" aria-label="Main navigation">
          <NavButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<LayoutDashboard/>}>Overview</NavButton>
          <NavButton active={tab === "expenses"} onClick={() => setTab("expenses")} icon={<Receipt/>}>Expenses</NavButton>
          <NavButton active={tab === "settlements"} onClick={() => setTab("settlements")} icon={<WalletCards/>}>Settle up</NavButton>
          <NavButton active={tab === "recurring"} onClick={() => setTab("recurring")} icon={<Repeat2/>}>Recurring</NavButton>
          <NavButton active={tab === "people"} onClick={() => setTab("people")} icon={<Users/>}>People</NavButton>
        </nav>
        <div className="sidebar-footer"><ProfileMenu user={user} member={currentMember} darkMode={darkMode} onDarkModeChange={changeTheme} onHelp={()=>setTab("help")} onSignOut={()=>void signOut()}/></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p>{tab === "help" ? "MohaNagorik guide" : new Intl.DateTimeFormat("en", {month:"long", year:"numeric"}).format(new Date(`${selectedMonth}-01T12:00:00`))}</p><h1>{tab === "overview" ? "Good to see you" : tab === "help" ? "Help & guide" : tab[0].toUpperCase() + tab.slice(1)}</h1></div>
          <div className="top-actions">
            <label className="month-filter"><span>Month</span><Input type="month" value={selectedMonth} max={today().slice(0,7)} onChange={(event)=>{const month=event.target.value;if(month){setSelectedMonth(month);void load(activeId,month);}}}/></label>
            <ProfileMenu compact user={user} member={currentMember} darkMode={darkMode} onDarkModeChange={changeTheme} onHelp={()=>setTab("help")} onSignOut={()=>void signOut()} data={data} activeId={activeId} onHouseholdSwitch={(id)=>{setTab("overview");void load(id);}} onManageHouseholds={()=>setTab("households")}/>
          </div>
        </header>

        <Tabs value={tab} onValueChange={setTab} className="content-tabs">
          <TabsList className="mobile-tabs" variant="line">
            <TabsTrigger value="overview"><Home/>Home</TabsTrigger><TabsTrigger value="expenses"><Receipt/>Expenses</TabsTrigger>
            <TabsTrigger value="settlements"><WalletCards/>Settle</TabsTrigger><TabsTrigger value="recurring"><Repeat2/>Bills</TabsTrigger><TabsTrigger value="people"><Users/>People</TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><Overview active={active} balance={currentBalance} onExpense={() => setExpenseOpen(true)} onSettle={(s) => {setSelectedSuggestion(s);setSettleOpen(true);}} /></TabsContent>
          <TabsContent value="expenses"><ExpensesView active={active} expenses={active.expenses} search={search} setSearch={setSearch} onVoid={(id) => run({action:"void_expense",expenseId:id},"Expense removed")} /></TabsContent>
          <TabsContent value="settlements"><SettlementsView active={active} onSettle={(s) => {setSelectedSuggestion(s);setSettleOpen(true);}} /></TabsContent>
          <TabsContent value="recurring"><RecurringView active={active} onAdd={() => setRecurringOpen(true)} onPost={(id) => run({action:"post_recurring",recurringId:id},"Bill added to expenses")} /></TabsContent>
          <TabsContent value="people"><PeopleView active={active} onUpdated={() => load(activeId)} /></TabsContent>
          <TabsContent value="help"><HelpView onNavigate={setTab} onExpense={()=>setExpenseOpen(true)}/></TabsContent>
          <TabsContent value="households"><HouseholdsView data={data} activeId={activeId} creationCooldownUntil={householdCreationCooldownUntil} onSwitch={(id) => {setTab("overview");void load(id);}} onCreate={async(name,currency)=>{setHouseholdCreationCooldownUntil(Date.now()+10_000);await run({action:"create_household",name,currency},"Household created");setTab("overview");}} onJoin={async(inviteCode)=>{await run({action:"join_household",inviteCode},"Household joined");setTab("overview");}} onDelete={deleteHousehold} onLeave={leaveHousehold} /></TabsContent>
        </Tabs>
      </section>

      <ExpenseDialog key={`${active.household.id}-${expenseOpen}`} open={expenseOpen} onOpenChange={setExpenseOpen} active={active} onSave={async (payload, file) => {
        const result = await run({action:"create_expense",...payload},"Expense added");
        if (file && result.expenseId) { const form = new FormData(); form.set("expenseId", result.expenseId); form.set("file", file); const upload = await fetch("/api/receipts", {method:"POST",body:form}); if (!upload.ok) toast.warning("Expense saved, but the receipt could not be uploaded"); else await load(activeId); }
        setExpenseOpen(false);
      }}/>
      <SettlementDialog key={`${selectedSuggestion?.fromMemberId ?? "manual"}-${selectedSuggestion?.toMemberId ?? "manual"}-${settleOpen}`} open={settleOpen} onOpenChange={(value) => {setSettleOpen(value);if(!value)setSelectedSuggestion(null);}} active={active} suggestion={selectedSuggestion} onSave={async (payload) => {await run({action:"create_settlement",...payload},"Settlement recorded");setSettleOpen(false);setSelectedSuggestion(null);}} />
      <RecurringDialog open={recurringOpen} onOpenChange={setRecurringOpen} active={active} onSave={async (payload) => {await run({action:"create_recurring",...payload},"Recurring bill created");setRecurringOpen(false);}} />
      <Toaster position="top-center" richColors theme={darkMode?"dark":"light"}/>
    </main>
  );
}

function LoadingScreen() { return <div className="loading-screen"><BrandLogo size={64} priority/><RefreshCw className="spin"/><span>Opening your household…</span></div>; }
function LoadError({message,onRetry}:{message:string;onRetry:()=>void}) { return <div className="loading-screen load-error"><BrandLogo size={64} priority/><TriangleAlert/><strong>MohaNagorik could not load</strong><span>{message}</span><Button onClick={onRetry}><RefreshCw/>Try again</Button></div>; }

function Onboarding({user,darkMode,onDone}:{user:{name:string;email:string};darkMode:boolean;onDone:(id:string)=>void}) {
  const [mode,setMode] = useState<"create"|"join">("create"); const [name,setName]=useState(""); const [code,setCode]=useState(""); const [currency,setCurrency]=useState("BDT"); const [busy,setBusy]=useState(false);const[cooldownUntil,setCooldownUntil]=useState(0);const[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(cooldownUntil<=Date.now())return;const timer=window.setInterval(()=>setNow(Date.now()),250);return()=>window.clearInterval(timer);},[cooldownUntil]);
  const remaining=Math.max(0,Math.ceil((cooldownUntil-now)/1000));
  const submit = async () => { if(mode==="create"&&remaining>0)return;try { setBusy(true);if(mode==="create")setCooldownUntil(Date.now()+10_000); const result = await api(mode === "create" ? {action:"create_household",name,currency} : {action:"join_household",inviteCode:code}); if(!result.householdId)throw new Error("Household could not be opened");toast.success(mode === "create" ? "Your household is ready" : "Welcome home"); onDone(result.householdId); } catch(error){toast.error(error instanceof Error?error.message:"Unable to continue");} finally{setBusy(false);} };
  return <main className="onboarding-shell"><section className="onboarding-card"><div className="brand"><BrandLogo size={34} priority/><span>MohaNagorik</span></div><div className="welcome-icon"><Home/></div><p className="eyebrow">Welcome, {user.name.split(" ")[0].split("@")[0]}</p><h1>{mode === "create" ? "Let’s set up your household" : "Join your household"}</h1><p>{mode === "create" ? "Give your shared space a name. You can invite everyone else next." : "Enter the invite code shared by someone in your household."}</p><div className="mode-tabs"><button className={mode === "create"?"active":""} onClick={()=>setMode("create")} disabled={busy}>Create new</button><button className={mode === "join"?"active":""} onClick={()=>setMode("join")} disabled={busy}>Join with code</button></div>{mode === "create" ? <div className="onboarding-fields"><label>Household name<Input value={name} onChange={(e)=>setName(e.target.value)} placeholder="e.g. Banani Flat" autoFocus disabled={busy}/></label><label>Currency<Select value={currency} onValueChange={setCurrency} disabled={busy}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["BDT","USD","GBP","EUR","INR"].map((c)=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></label></div> : <label>Invite code<Input value={code} onChange={(e)=>setCode(e.target.value.toUpperCase())} placeholder="8–12 character code" autoFocus disabled={busy}/></label>}<Button className="wide-button" disabled={busy || (mode === "create" ? name.length < 2||remaining>0 : code.length < 6)} onClick={submit}>{busy?<RefreshCw className="spin"/>:<ArrowUpRight/>}{busy?(mode==="create"?"Creating…":"Joining…"):mode==="create"&&remaining>0?`Wait ${remaining}s`:(mode === "create" ? "Create household" : "Join household")}</Button></section><Toaster position="top-center" richColors theme={darkMode?"dark":"light"}/></main>;
}

function NavButton({active,onClick,icon,children}:{active:boolean;onClick:()=>void;icon:React.ReactNode;children:React.ReactNode}) { return <button className={active?"active":""} onClick={onClick}>{icon}<span>{children}</span></button>; }

function ProfileMenu({user,member,darkMode,onDarkModeChange,onHelp,onSignOut,compact=false,data,activeId,onHouseholdSwitch,onManageHouseholds}:{user:{name:string;email:string};member?:Member;darkMode:boolean;onDarkModeChange:(dark:boolean)=>void;onHelp:()=>void;onSignOut:()=>void;compact?:boolean;data?:AppData;activeId?:string;onHouseholdSwitch?:(id:string)=>void;onManageHouseholds?:()=>void}) {
  const [open,setOpen]=useState(false);
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>{compact?<button className="mobile-profile-trigger" aria-label="Open account and settings"><Settings/></button>:<button className="profile-trigger" aria-label="Open account and settings"><MemberAvatar member={member} fallbackName={user.name}/><span className="profile-copy"><strong>{user.name.split("@")[0]}</strong><small>{user.email}</small></span><Settings/></button>}</PopoverTrigger><PopoverContent side={compact?"bottom":"top"} align={compact?"end":"start"} sideOffset={9} className="profile-menu"><div className="profile-menu-account"><MemberAvatar member={member} fallbackName={user.name}/><span><b>{user.name.split("@")[0]}</b><small>{user.email}</small></span></div>{compact&&data&&<><div className="profile-menu-separator"/><div className="mobile-household-menu"><small>HOUSEHOLD</small>{data.households.map((household)=><button key={household.id} className={household.id===activeId?"active":""} onClick={()=>{setOpen(false);if(household.id!==activeId)onHouseholdSwitch?.(household.id);}}><Home/><span>{household.name}</span>{household.id===activeId&&<Check/>}</button>)}<button className="manage-mobile-households" onClick={()=>{setOpen(false);onManageHouseholds?.();}}><Plus/><span>Manage households</span><ArrowUpRight/></button></div></>}<div className="profile-menu-separator"/><button className="profile-menu-item" onClick={()=>{setOpen(false);onHelp();}}><CircleHelp/><span>Help & guide</span></button><div className="profile-menu-item theme-menu-item"><Moon/><span>Dark mode</span><Switch checked={darkMode} onCheckedChange={onDarkModeChange} aria-label="Dark mode"/></div><div className="profile-menu-separator"/><button className="profile-menu-item sign-out-item" onClick={()=>{setOpen(false);onSignOut();}}><LogOut/><span>Sign out</span></button></PopoverContent></Popover>;
}

function HouseholdSwitcher({data,activeId,onSwitch,onManage}:{data:AppData;activeId:string;onSwitch:(id:string)=>void;onManage:()=>void}) {
  const [open,setOpen]=useState(false);
  const active=data.households.find((household)=>household.id===activeId)||data.households[0];
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button className="household-switch" aria-label="Select household" aria-expanded={open}><div><small>HOUSEHOLD</small><strong>{active?.name||"Select household"}</strong></div><ChevronDown size={16} className={open?"switch-chevron open":"switch-chevron"}/></button></PopoverTrigger>
    <PopoverContent align="start" sideOffset={8} className="household-popover"><div className="household-popover-head"><b>Your households</b><span>{data.households.length}</span></div><div className="household-switch-list">{data.households.map((household)=><button key={household.id} className={household.id===activeId?"active":""} onClick={()=>{setOpen(false);if(household.id!==activeId)onSwitch(household.id);}}><span><Home/></span><div><b>{household.name}</b><small>{household.currency}</small></div>{household.id===activeId&&<Check/>}</button>)}</div><button className="manage-households" onClick={()=>{setOpen(false);onManage();}}><Plus/><span><b>Manage households</b><small>Create, join, switch, or delete</small></span><ArrowUpRight/></button></PopoverContent>
  </Popover>;
}

const helpFaqs=[
  {category:"Expenses",question:"How does an equal split work?",answer:"Select everyone who shared the expense. MohaNagorik divides the amount equally between only those selected members. Any leftover cent is assigned automatically so the total always stays exact."},
  {category:"Expenses",question:"When should I use a custom split?",answer:"Use Exact amounts when members owe different amounts. Enter each selected member’s share; the assigned amounts must add up to the full expense total before it can be saved."},
  {category:"Balances",question:"What do “you owe” and “you are owed” mean?",answer:"You owe means your assigned share is greater than what you have paid. You are owed means you paid more than your assigned share. Balances include all active expenses and recorded settlements."},
  {category:"Settlements",question:"How are settlement suggestions calculated?",answer:"MohaNagorik compares what every member paid with what they owe, then suggests the fewest payments needed to clear the household balances. Custom splits are respected."},
  {category:"Settlements",question:"What changes after I record a payment?",answer:"The payer’s balance moves toward zero and the receiver’s balance reduces by the same amount. The payment also appears in that month’s Paid by member calculation."},
  {category:"Monthly view",question:"What does the month filter change?",answer:"It changes monthly activity, category totals, and Paid by member figures using the expense or settlement date. Current balances remain cumulative across all months."},
  {category:"Monthly view",question:"How is “Paid by member” calculated?",answer:"For the selected month it is: expenses personally paid, plus settlements sent, minus settlements received. After everyone settles an equal split, each member’s net spending becomes equal. A custom split follows the assigned shares instead."},
  {category:"Recurring bills",question:"Does saving a recurring bill create an expense?",answer:"No. It creates a reusable template. Use Post now on the Recurring page, or choose Use a recurring bill while adding an expense, to create the actual expense."},
  {category:"Recurring bills",question:"Why can’t I post the same recurring bill again immediately?",answer:"After confirmation, the bill shows Posted and is locked for 10 seconds. This prevents accidental duplicate expenses from repeated clicks."},
  {category:"Expenses",question:"Can I edit or remove an expense?",answer:"To correct an expense, remove it from the Expenses page and add it again. MohaNagorik asks for confirmation before removal and then recalculates all connected balances."},
  {category:"People",question:"Who can manage the household?",answer:"Every household member has equal access and contribution. There is no owner role. Each person can edit only their own profile picture."},
  {category:"People",question:"How do category-limited members work?",answer:"Open People and choose Category access. A member set to selected categories can add, pay for, and be included only in new expenses from those categories. Existing expenses, balances, and settlements are never rewritten. Recurring bills that conflict with a new restriction are paused."},
  {category:"Households",question:"How do I invite someone?",answer:"Open People, copy the household invite code, and share it privately. The new member signs in with Google, selects Join with code, and enters that code."},
  {category:"Households",question:"How do I delete a household?",answer:"Open the household selector on desktop, or Settings on mobile, choose Manage households, then select the delete button beside that household. You must type delete exactly. This permanently removes the household and its data for every member."},
  {category:"Households",question:"Is rent included?",answer:"No. MohaNagorik intentionally excludes rent and does not use it in expenses, monthly totals, balances, or settlements."},
];

function HelpView({onNavigate,onExpense}:{onNavigate:(tab:string)=>void;onExpense:()=>void}) {
  const [query,setQuery]=useState("");
  const normalized=query.trim().toLowerCase();
  const visibleFaqs=helpFaqs.filter((item)=>!normalized||`${item.category} ${item.question} ${item.answer}`.toLowerCase().includes(normalized));
  const steps=[
    {icon:<UserPlus/>,title:"Create or join",copy:"Create a household, or join one using its private invite code.",open:()=>onNavigate("households"),action:"Households"},
    {icon:<Receipt/>,title:"Add an expense",copy:"Enter who paid, the amount, category, date, and the members sharing it.",open:onExpense,action:"Add expense"},
    {icon:<Users/>,title:"Choose the split",copy:"Split equally, or enter exact amounts when each person owes a different share.",open:onExpense,action:"Add expense"},
    {icon:<LayoutDashboard/>,title:"Check the month",copy:"Use the month filter to review activity, categories, and each member’s spending.",open:()=>onNavigate("overview"),action:"Overview"},
    {icon:<WalletCards/>,title:"Record payments",copy:"Follow the suggested transfers and record each payment after it is completed.",open:()=>onNavigate("settlements"),action:"Settle up"},
    {icon:<Repeat2/>,title:"Save regular bills",copy:"Create recurring templates, then post them only when the bill is due.",open:()=>onNavigate("recurring"),action:"Recurring"},
  ];
  return <div className="help-layout">
    <section className="help-intro">
      <div><span className="help-icon"><BookOpen/></span><p className="eyebrow">Quick start</p><h2>Share expenses without the spreadsheet</h2><p>Record every shared cost, let MohaNagorik calculate each person’s share, then settle the exact balances.</p></div>
      <div className="help-rule"><Check/><span><b>The simple rule</b><small>Record the expense when it happens. Record a settlement only after money is actually paid.</small></span></div>
    </section>
    <section className="help-steps" aria-labelledby="quick-start-title"><div className="section-heading"><div><h2 id="quick-start-title">How to use MohaNagorik</h2><p>Six steps cover the complete monthly workflow.</p></div></div><div className="help-step-grid">{steps.map((step,index)=><article key={step.title}><span className="step-number">{index+1}</span><span className="step-icon">{step.icon}</span><h3>{step.title}</h3><p>{step.copy}</p><button onClick={step.open}>Open {step.action}<ArrowUpRight/></button></article>)}</div></section>
    <section className="help-faq page-card" aria-labelledby="faq-title"><div className="help-faq-head"><div><p className="eyebrow">Frequently asked questions</p><h2 id="faq-title">Clear answers, when you need them</h2></div><div className="help-search"><Search/><Input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search help" aria-label="Search help and frequently asked questions"/></div></div>{visibleFaqs.length?<Accordion type="multiple" className="faq-list">{visibleFaqs.map((item,index)=><AccordionItem key={item.question} value={`faq-${index}`}><AccordionTrigger><span><small>{item.category}</small>{item.question}</span></AccordionTrigger><AccordionContent><p>{item.answer}</p></AccordionContent></AccordionItem>)}</Accordion>:<div className="help-empty"><Search/><h3>No matching answer</h3><p>Try “settlement”, “monthly”, “custom split”, or “recurring”.</p></div>}</section>
  </div>;
}

function Overview({active,balance,onExpense,onSettle}:{active:ActiveData;balance:number;onExpense:()=>void;onSettle:(s:Suggestion)=>void}) {
  const maxCategory = Math.max(...active.categories.map((c)=>c.amountCents),1);
  const maxMemberSpending = Math.max(...active.memberSpending.map((member)=>Math.abs(member.amountCents)),1);
  const monthLabel = new Intl.DateTimeFormat("en", {month:"long",year:"numeric"}).format(new Date(`${active.selectedMonth}-01T12:00:00`));
  return <div className="overview-grid"><section className="main-column"><div className={`balance-card ${balance < 0 ? "negative":""}`}><div className="balance-top"><div><p>Your balance</p><strong>{formatMoney(balance,active.household.currency)}</strong><span>{balance===0?"all settled":balance>0?"you are owed":"you owe"}</span></div><div className="balance-orbit"><span>{balance>=0?<ArrowDownLeft/>:<ArrowUpRight/>}</span></div></div><div className="balance-actions"><button onClick={onExpense}><Plus/>Add an expense</button><button onClick={()=>active.suggestedSettlements[0]&&onSettle(active.suggestedSettlements[0])}><Check/>Record payment</button></div></div>
  <div className="section-heading"><div><h2>{monthLabel} activity</h2><p>{active.monthlyExpenses.length} recorded expenses</p></div></div><div className="activity-card">{active.monthlyExpenses.length ? active.monthlyExpenses.slice(0,5).map((expense)=><ExpenseRow key={expense.id} expense={expense} currency={active.household.currency} members={active.members}/>) : <EmptyState icon={<Receipt/>} title="No expenses this month" copy={`Add an expense dated in ${monthLabel} to see it here.`} action={onExpense}/>}</div></section>
  <aside className="insight-column"><div className="summary-card"><div className="section-heading"><div><h2>{monthLabel}</h2><p>Total household spending</p></div><strong>{formatMoney(active.monthTotalCents,active.household.currency)}</strong></div><div className="category-bars">{active.categories.length?active.categories.slice(0,5).map((category)=><div key={category.name}><div><span>{category.name}</span><b>{formatMoney(category.amountCents,active.household.currency)}</b></div><i><em style={{width:`${Math.max(5,category.amountCents/maxCategory*100)}%`}}/></i></div>):<p className="muted">Categories appear after your first expense.</p>}</div></div>
  <div className="summary-card member-spending-card"><div className="section-heading"><div><h2>Net spent by member</h2><p>Expenses + settlements − reimbursements in {monthLabel}</p></div></div><div className="category-bars member-bars">{active.memberSpending.map((member)=><div key={member.memberId}><div><span>{member.name}</span><b>{formatSignedMoney(member.amountCents,active.household.currency)}</b></div><i><em style={{width:`${member.amountCents ? Math.max(5,Math.abs(member.amountCents)/maxMemberSpending*100) : 0}%`}}/></i></div>)}</div></div>
  <div className="settle-card"><div className="settle-title"><span><Sparkles/></span><div><h2>Simplest settle-up</h2><p>{active.suggestedSettlements.length?`${active.suggestedSettlements.length} payment${active.suggestedSettlements.length===1?"":"s"} clears the group`:"Nothing to settle"}</p></div></div>{active.suggestedSettlements.slice(0,3).map((s)=><button key={`${s.fromMemberId}-${s.toMemberId}`} onClick={()=>onSettle(s)}><div className="avatar-stack"><span>{initials(s.fromName)}</span><ArrowUpRight/><span>{initials(s.toName)}</span></div><div><b>{s.fromName.split(" ")[0]} → {s.toName.split(" ")[0]}</b><small>{formatMoney(s.amountCents,active.household.currency)}</small></div><ChevronDown className="rotate"/></button>)}</div></aside></div>;
}

function ExpenseRow({expense,currency,members,onVoid}:{expense:Expense;currency:string;members:Member[];onVoid?:(id:string)=>void}) {
  const [detailsOpen,setDetailsOpen]=useState(false);
  const splits=[...(expense.splits??[])].sort((a,b)=>b.share_cents-a.share_cents);
  const splitLabel=expense.split_type==="custom"?"Custom split":"Equal split";
  return <>
    <article className="expense-row">
      <div className={`category-icon cat-${expense.category.toLowerCase()}`}>{categoryIcons[expense.category]||"•"}</div>
      <div className="expense-main"><strong>{expense.description}</strong><span>{expense.category}<i/> {"Paid by"} {expense.payer_name}</span></div>
      <div className="expense-date"><span>Date</span><b>{displayDate(expense.expense_date)}</b></div>
      <div className="expense-amount"><strong>{formatMoney(expense.amount_cents,currency)}</strong><span>{splitLabel}</span></div>
      <div className="expense-actions">
        {expense.receipt_key&&<a className="receipt-link" aria-label={`View receipt for ${expense.description}`} title="View receipt" href={`/api/receipts?expenseId=${expense.id}`} target="_blank" rel="noreferrer"><FileText/></a>}
        <button className="expense-details-button" onClick={()=>setDetailsOpen(true)} aria-label={`View details for ${expense.description}`}><span>Details</span><ChevronRight/></button>
        {onVoid&&<button className="row-delete" aria-label={`Remove ${expense.description}`} title="Remove expense" onClick={()=>onVoid(expense.id)}><Trash2/></button>}
      </div>
    </article>
    <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}><DialogContent className="form-dialog compact expense-details-dialog"><DialogHeader><div className="expense-detail-title"><span className={`category-icon cat-${expense.category.toLowerCase()}`}>{categoryIcons[expense.category]||"•"}</span><div><DialogTitle>{expense.description}</DialogTitle><DialogDescription>{expense.category} expense</DialogDescription></div></div></DialogHeader><div className="expense-detail-amount"><span>Total expense</span><strong>{formatMoney(expense.amount_cents,currency)}</strong></div><div className="expense-detail-meta"><div><span>Paid by</span><b>{expense.payer_name}</b></div><div><span>Date</span><b>{displayFullDate(expense.expense_date)}</b></div><div><span>Split method</span><b>{splitLabel}</b></div></div><section className="expense-split-details"><div className="expense-detail-section-title"><div><h3>Split breakdown</h3><p>{splits.length} participant{splits.length===1?"":"s"}</p></div><strong>{formatMoney(splits.reduce((sum,split)=>sum+Number(split.share_cents),0),currency)}</strong></div><div className="expense-split-list">{splits.length?splits.map((split)=>{const splitMember=members.find((member)=>member.id===Number(split.member_id));const name=splitMember?.display_name??"Former member";return <div key={`${expense.id}-${split.member_id}`}><MemberAvatar member={splitMember} fallbackName={name}/><div><b>{name}</b><small>{Math.round(Number(split.share_cents)/expense.amount_cents*100)}% of total</small></div><strong>{formatMoney(Number(split.share_cents),currency)}</strong></div>}):<p className="muted">Split information is unavailable for this expense.</p>}</div></section>{expense.notes&&<section className="expense-detail-notes"><span>Notes</span><p>{expense.notes}</p></section>}{expense.receipt_key&&<a className="expense-receipt-button" href={`/api/receipts?expenseId=${expense.id}`} target="_blank" rel="noreferrer"><FileText/>View attached receipt<ChevronRight/></a>}</DialogContent></Dialog>
  </>;
}

function ExpensesView({active,expenses,search,setSearch,onVoid}:{active:ActiveData;expenses:Expense[];search:string;setSearch:(v:string)=>void;onVoid:(id:string)=>Promise<unknown>}) {
  const [person,setPerson]=useState("all");
  const [category,setCategory]=useState("all");
  const [pending,setPending]=useState<Expense|null>(null);
  const [removing,setRemoving]=useState(false);
  const categoryOptions=[...new Set(expenses.map((expense)=>expense.category))].sort();
  const visible=expenses.filter((expense)=>{
    const matchesSearch=`${expense.description} ${expense.category} ${expense.payer_name}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch&&(person==="all"||String(expense.paid_by_member_id)===person)&&(category==="all"||expense.category===category);
  });
  const confirmRemove=async()=>{if(!pending)return;try{setRemoving(true);await onVoid(pending.id);setPending(null);}finally{setRemoving(false);}};
  return <section className="page-card">
    <div className="toolbar expense-toolbar">
      <div className="search-box"><Search/><Input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search expenses"/></div>
      <Select value={person} onValueChange={setPerson}><SelectTrigger className="expense-filter"><SelectValue placeholder="All people"/></SelectTrigger><SelectContent><SelectItem value="all">All people</SelectItem>{active.members.map((member)=><SelectItem key={member.id} value={String(member.id)}>{member.display_name}</SelectItem>)}</SelectContent></Select>
      <Select value={category} onValueChange={setCategory}><SelectTrigger className="expense-filter"><SelectValue placeholder="All categories"/></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categoryOptions.map((item)=><SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>
      <div className="count-pill">{visible.length} expenses</div>
    </div>
    <div className="expense-list">{visible.map((expense)=><ExpenseRow key={expense.id} expense={expense} currency={active.household.currency} members={active.members} onVoid={()=>setPending(expense)}/>)}{!visible.length&&<EmptyState icon={<Search/>} title="No matching expenses" copy="Try another search, person, or category."/>}</div>
    <AlertDialog open={Boolean(pending)} onOpenChange={(open)=>{if(!open&&!removing)setPending(null);}}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove this expense?</AlertDialogTitle><AlertDialogDescription>{pending?`${pending.description} · ${formatMoney(pending.amount_cents,active.household.currency)} will be removed from balances and settlements.`:"This expense will be removed."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel><AlertDialogAction disabled={removing} onClick={()=>void confirmRemove().catch(()=>undefined)}>{removing?"Removing…":"Remove expense"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </section>;
}

function SettlementsView({active,onSettle}:{active:ActiveData;onSettle:(s:Suggestion)=>void}) { return <div className="two-column"><section className="page-card"><div className="section-heading"><div><h2>Recommended payments</h2><p>The fewest transfers needed to clear all balances.</p></div></div><div className="recommendations">{active.suggestedSettlements.length?active.suggestedSettlements.map((s)=><article key={`${s.fromMemberId}-${s.toMemberId}`}><div className="payment-flow"><span>{initials(s.fromName)}</span><div><i/><small>pays</small></div><span>{initials(s.toName)}</span></div><div className="payment-names"><b>{s.fromName}</b><small>to {s.toName}</small></div><strong>{formatMoney(s.amountCents,active.household.currency)}</strong><Button size="sm" onClick={()=>onSettle(s)}>Record</Button></article>):<EmptyState icon={<Check/>} title="Everyone is settled" copy="There are no outstanding balances right now."/>}</div></section><aside className="page-card"><div className="section-heading"><div><h2>Member balances</h2><p>After all expenses and payments</p></div></div><div className="balance-list">{active.balances.map((b)=><div key={b.memberId}><span className="member-avatar">{initials(b.name)}</span><div><b>{b.name}{b.isCurrentUser?" (you)":""}</b><small>{b.amountCents===0?"settled":b.amountCents>0?"gets back":"owes"}</small></div><strong className={b.amountCents<0?"owes":"gets"}>{formatMoney(b.amountCents,active.household.currency)}</strong></div>)}</div></aside></div>; }

function RecurringView({active,onAdd,onPost}:{active:ActiveData;onAdd:()=>void;onPost:(id:string)=>Promise<unknown>}) {
  const [pending,setPending]=useState<Recurring|null>(null);
  const [posting,setPosting]=useState(false);
  const [now,setNow]=useState(()=>Date.now());
  const [postedUntil,setPostedUntil]=useState<Record<string,number>>({});
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(timer);},[]);
  const secondsLeft=(item:Recurring)=>{
    const serverUntil=item.last_posted_at?Date.parse(item.last_posted_at)+10_000:0;
    const until=Math.max(serverUntil,postedUntil[item.id]||0);
    return Math.max(0,Math.ceil((until-now)/1000)||0);
  };
  const confirmPost=async()=>{if(!pending)return;const recurringId=pending.id;try{setPosting(true);await onPost(recurringId);const postedAt=Date.now();setNow(postedAt);setPostedUntil((current)=>({...current,[recurringId]:postedAt+10_000}));setPending(null);}finally{setPosting(false);}};
  return <section className="page-card">
    <div className="section-heading recurring-head"><div><h2>Recurring bills</h2><p>Keep regular utilities and subscriptions ready to post.</p></div><Button onClick={onAdd}><Plus/>New recurring bill</Button></div>
    <div className="recurring-grid">{active.recurring.map((item)=>{const cooldown=secondsLeft(item);return <article key={item.id}><div className="recurring-icon"><CalendarClock/></div><div className="recurring-copy"><div className="recurring-kicker"><span>{item.category}</span>{cooldown>0&&<span className="posted-badge"><Check/>Posted</span>}</div><h3>{item.description}</h3><p>Paid by {item.payer_name} · {item.cadence}</p></div><strong>{formatMoney(item.amount_cents,active.household.currency)}</strong><div className="due-line"><span>Next due {displayDate(item.next_due_date)}</span><Button variant="outline" size="sm" disabled={cooldown>0} onClick={()=>setPending(item)}>{cooldown>0?`Posted · ${cooldown}s`:"Post now"}</Button></div></article>;})}{!active.recurring.length&&<EmptyState icon={<Repeat2/>} title="No recurring bills" copy="Save utilities or subscriptions so they are ready each month." action={onAdd}/>}</div>
    <AlertDialog open={Boolean(pending)} onOpenChange={(open)=>{if(!open&&!posting)setPending(null);}}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Post this recurring bill?</AlertDialogTitle><AlertDialogDescription>{pending?`${pending.description} · ${formatMoney(pending.amount_cents,active.household.currency)} will be added to expenses now.`:"This bill will be added to expenses."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={posting}>Cancel</AlertDialogCancel><AlertDialogAction disabled={posting} onClick={()=>void confirmPost().catch(()=>undefined)}>{posting?"Posting…":"Post bill"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </section>;
}

const avatarPresets:Record<string,string>={indigo:"✦",lime:"●",sunset:"☀",ocean:"≈",rose:"♥",violet:"◆"};

function MemberAvatar({member,fallbackName,className=""}:{member?:Member;fallbackName?:string;className?:string}) {
  const name=member?.display_name||fallbackName||"Member";
  // The protected avatar route requires the viewer's session cookie, so it cannot use the public image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  if(member?.avatar_key)return <span className={`member-avatar avatar-photo ${className}`}><img src={`/api/avatars?memberId=${member.id}&v=${encodeURIComponent(member.avatar_key)}`} alt={`${name}'s profile`}/></span>;
  const choice=member?.avatar_choice||"indigo";
  return <span className={`member-avatar avatar-${choice} ${className}`}>{avatarPresets[choice]||initials(name)}</span>;
}

const AVATAR_CROP_SIZE=220;

async function croppedAvatarFile(source:string,imageSize:{width:number;height:number},zoom:number,offset:{x:number;y:number}) {
  const image=new Image();
  image.src=source;
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error("Unable to read this image"));});
  const baseScale=Math.max(AVATAR_CROP_SIZE/imageSize.width,AVATAR_CROP_SIZE/imageSize.height);
  const renderedScale=baseScale*zoom;
  const sourceX=(imageSize.width/2)-((AVATAR_CROP_SIZE/2+offset.x)/renderedScale);
  const sourceY=(imageSize.height/2)-((AVATAR_CROP_SIZE/2+offset.y)/renderedScale);
  const sourceSize=AVATAR_CROP_SIZE/renderedScale;
  const canvas=document.createElement("canvas");
  canvas.width=512;
  canvas.height=512;
  const context=canvas.getContext("2d");
  if(!context)throw new Error("Photo editor is unavailable");
  context.drawImage(image,sourceX,sourceY,sourceSize,sourceSize,0,0,512,512);
  const blob=await new Promise<Blob|null>((resolve)=>canvas.toBlob(resolve,"image/webp",.9));
  if(!blob)throw new Error("Unable to prepare this photo");
  return new File([blob],"profile-photo.webp",{type:"image/webp"});
}

function PeopleView({active,onUpdated}:{active:ActiveData;onUpdated:()=>Promise<void>}) {
  const current=active.members.find((member)=>member.id===active.currentMemberId);
  const [editing,setEditing]=useState(false);
  const [choice,setChoice]=useState(current?.avatar_choice||"indigo");
  const [file,setFile]=useState<File|null>(null);
  const [previewUrl,setPreviewUrl]=useState("");
  const [imageSize,setImageSize]=useState({width:0,height:0});
  const [zoom,setZoom]=useState(1);
  const [offset,setOffset]=useState({x:0,y:0});
  const [saving,setSaving]=useState(false);
  const [accessOpen,setAccessOpen]=useState(false);
  const inputRef=useRef<HTMLInputElement>(null);
  const previewUrlRef=useRef("");
  const dragRef=useRef<{pointerId:number;startX:number;startY:number;originX:number;originY:number}|null>(null);
  useEffect(()=>()=>{if(previewUrlRef.current)URL.revokeObjectURL(previewUrlRef.current);},[]);
  const clampOffset=(next:{x:number;y:number},nextZoom=zoom)=>{
    if(!imageSize.width||!imageSize.height)return {x:0,y:0};
    const scale=Math.max(AVATAR_CROP_SIZE/imageSize.width,AVATAR_CROP_SIZE/imageSize.height)*nextZoom;
    const maxX=Math.max(0,(imageSize.width*scale-AVATAR_CROP_SIZE)/2);
    const maxY=Math.max(0,(imageSize.height*scale-AVATAR_CROP_SIZE)/2);
    return {x:Math.max(-maxX,Math.min(maxX,next.x)),y:Math.max(-maxY,Math.min(maxY,next.y))};
  };
  const chooseFile=(next:File|null)=>{if(previewUrlRef.current)URL.revokeObjectURL(previewUrlRef.current);const nextUrl=next?URL.createObjectURL(next):"";previewUrlRef.current=nextUrl;setFile(next);setPreviewUrl(nextUrl);setZoom(1);setOffset({x:0,y:0});setImageSize({width:0,height:0});if(next)setChoice("");};
  const choosePreset=(key:string)=>{setChoice(key);chooseFile(null);if(inputRef.current)inputRef.current.value="";};
  const openEditor=async(member:Member)=>{
    setChoice(member.avatar_choice||"indigo");chooseFile(null);setEditing(true);
    if(!member.avatar_key)return;
    try{const response=await fetch(`/api/avatars?memberId=${member.id}&v=${encodeURIComponent(member.avatar_key)}`);if(!response.ok)throw new Error();const blob=await response.blob();chooseFile(new File([blob],"current-profile-photo",{type:blob.type||"image/webp"}));}catch{toast.error("Choose a new photo to replace the current one");}
  };
  const copy=async()=>{await navigator.clipboard.writeText(active.household.invite_code);toast.success("Invite code copied");};
  const save=async()=>{if(!current)return;try{setSaving(true);if(file){if(!previewUrl||!imageSize.width)throw new Error("Wait for the photo preview to load");const cropped=await croppedAvatarFile(previewUrl,imageSize,zoom,offset);const form=new FormData();form.set("householdId",active.household.id);form.set("file",cropped);const response=await fetch("/api/avatars",{method:"POST",body:form});const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||"Unable to upload photo");}else{await api({action:"update_avatar_choice",householdId:active.household.id,avatarChoice:choice});}await onUpdated();toast.success("Profile picture updated");setEditing(false);chooseFile(null);}catch(error){toast.error(error instanceof Error?error.message:"Unable to update profile picture");}finally{setSaving(false);}};
  return <div className="two-column">
    <section className="page-card"><div className="section-heading people-heading"><div><h2>People in {active.household.name}</h2><p>Members can contribute to every category or only selected ones.</p></div><Button variant="outline" size="sm" onClick={()=>setAccessOpen(true)}><SlidersHorizontal/>Category access</Button></div><div className="people-list">{active.members.map((member)=>{const applicable=memberCategories(member);return <div key={member.id}><MemberAvatar member={member} className="large"/><div className="person-copy"><b>{member.display_name}</b><small>{member.id===active.currentMemberId?"You":"Household member"}</small><span className={`category-access-badge ${applicable?"restricted":"all"}`}>{applicable?applicable.length===1?`${applicable[0]} only`:`${applicable.length} categories`:"All categories"}</span></div>{member.id===active.currentMemberId&&<Button variant="outline" size="sm" className="avatar-edit" onClick={()=>void openEditor(member)}><Camera/>Edit photo</Button>}</div>;})}</div></section>
    <aside className="invite-card"><div className="invite-icon"><Users/></div><p className="eyebrow">Invite your housemates</p><h2>One code. Everyone in.</h2><p>Share this private code. New members can join after signing in.</p><button className="code-box" onClick={copy}><b>{active.household.invite_code}</b><Copy/></button><small>Only share it with people you trust.</small></aside>
    <Dialog open={editing} onOpenChange={(open)=>{if(!saving){setEditing(open);if(!open)chooseFile(null);}}}><DialogContent className="form-dialog compact avatar-dialog"><DialogHeader><DialogTitle>Choose your profile picture</DialogTitle><DialogDescription>Upload, position, and resize a photo inside the circle, or choose an avatar.</DialogDescription></DialogHeader>{file&&previewUrl?<div className="avatar-crop-editor"><div className="avatar-crop" aria-label="Circular profile photo crop" onPointerDown={(event)=>{event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,originX:offset.x,originY:offset.y};}} onPointerMove={(event)=>{const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;setOffset(clampOffset({x:drag.originX+event.clientX-drag.startX,y:drag.originY+event.clientY-drag.startY}));}} onPointerUp={(event)=>{if(dragRef.current?.pointerId===event.pointerId)dragRef.current=null;}} onPointerCancel={()=>{dragRef.current=null;}}><NextImage src={previewUrl} alt="Profile photo preview" width={512} height={512} unoptimized draggable={false} onLoad={(event)=>setImageSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} style={imageSize.width?{width:imageSize.width*Math.max(AVATAR_CROP_SIZE/imageSize.width,AVATAR_CROP_SIZE/imageSize.height)*zoom,height:imageSize.height*Math.max(AVATAR_CROP_SIZE/imageSize.width,AVATAR_CROP_SIZE/imageSize.height)*zoom,transform:`translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`}:undefined}/><span className="avatar-crop-guide"/></div><p className="avatar-crop-help">Drag to reposition</p><div className="avatar-zoom"><span>Smaller</span><Slider min={1} max={3} step={.01} value={[zoom]} aria-label="Zoom profile photo" onValueChange={([value])=>{setZoom(value);setOffset((currentOffset)=>clampOffset(currentOffset,value));}}/><span>Larger</span></div></div>:<div className="avatar-preview"><MemberAvatar member={{...current!,avatar_choice:choice||"indigo",avatar_key:null}} fallbackName={current?.display_name}/></div>}<div className="avatar-options">{Object.entries(avatarPresets).map(([key,symbol])=><button type="button" key={key} className={choice===key&&!file?"selected":""} aria-label={`Choose ${key} avatar`} aria-pressed={choice===key&&!file} onClick={()=>choosePreset(key)}><span className={`member-avatar avatar-${key}`}>{symbol}</span></button>)}</div><Field label={file?"Choose a different photo":"Upload your own photo"}><Input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event)=>chooseFile(event.target.files?.[0]||null)}/></Field><Button className="wide-button" disabled={saving||(!file&&!choice)||(Boolean(file)&&!imageSize.width)} onClick={()=>void save()}>{saving?<RefreshCw className="spin"/>:<Camera/>}Save profile picture</Button></DialogContent></Dialog>
    <CategoryAccessDialog open={accessOpen} onOpenChange={setAccessOpen} active={active} onSaved={onUpdated}/>
  </div>;
}

function CategoryAccessDialog({open,onOpenChange,active,onSaved}:{open:boolean;onOpenChange:(open:boolean)=>void;active:ActiveData;onSaved:()=>Promise<void>}) {
  const [memberId,setMemberId]=useState(String(active.members[0]?.id??""));
  const selectedMember=active.members.find((member)=>String(member.id)===memberId)??active.members[0];
  const stored=selectedMember?memberCategories(selectedMember):null;
  const [allCategories,setAllCategories]=useState(stored===null);
  const [selected,setSelected]=useState<string[]>(stored??categories);
  const [busy,setBusy]=useState(false);
  const selectMember=(value:string)=>{setMemberId(value);const next=active.members.find((member)=>String(member.id)===value);const applicable=next?memberCategories(next):null;setAllCategories(applicable===null);setSelected(applicable??categories);};
  const save=async()=>{if(!selectedMember||(!allCategories&&!selected.length))return;try{setBusy(true);const result=await api({action:"update_member_categories",householdId:active.household.id,memberId:selectedMember.id,applicableCategories:allCategories?null:selected});await onSaved();onOpenChange(false);toast.success(result.deactivatedRecurringCount?`Category access saved. ${result.deactivatedRecurringCount} incompatible recurring bill${result.deactivatedRecurringCount===1?" was":"s were"} paused.`:"Category access saved");}catch(error){toast.error(error instanceof Error?error.message:"Unable to save category access");}finally{setBusy(false);}};
  return <Dialog open={open} onOpenChange={(value)=>{if(!busy)onOpenChange(value);}}><DialogContent className="form-dialog compact category-access-dialog"><DialogHeader><DialogTitle>Edit category access</DialogTitle><DialogDescription>Choose which expense categories count for this member. This applies to new expenses only.</DialogDescription></DialogHeader><Field label="Person"><Select value={memberId} onValueChange={selectMember}><SelectTrigger><SelectValue placeholder="Choose a person"/></SelectTrigger><SelectContent>{active.members.map((member)=><SelectItem key={member.id} value={String(member.id)}>{member.display_name}{member.id===active.currentMemberId?" (you)":""}</SelectItem>)}</SelectContent></Select></Field><label className="all-categories-option"><Checkbox checked={allCategories} onCheckedChange={(checked)=>{setAllCategories(Boolean(checked));if(checked)setSelected(categories);}}/><span><b>All categories</b><small>This member joins every new household expense.</small></span></label><div className={`category-access-grid ${allCategories?"disabled":""}`}>{categories.map((category)=>{const checked=selected.includes(category);return <label key={category}><Checkbox disabled={allCategories} checked={allCategories||checked} onCheckedChange={()=>setSelected(checked?selected.filter((item)=>item!==category):[...selected,category])}/><span>{categoryIcons[category]}</span><b>{category}</b></label>;})}</div>{!allCategories&&!selected.length&&<p className="category-access-error">Select at least one category.</p>}<div className="category-access-note"><CircleHelp/><span>Existing expenses, balances, and settlements will not change. Incompatible recurring bills will be paused.</span></div><Button className="wide-button" disabled={busy||!selectedMember||(!allCategories&&!selected.length)} onClick={()=>void save()}>{busy?<RefreshCw className="spin"/>:<Check/>}Save category access</Button></DialogContent></Dialog>;
}

function HouseholdsView({data,activeId,creationCooldownUntil,onSwitch,onCreate,onJoin,onDelete,onLeave}:{data:AppData;activeId:string;creationCooldownUntil:number;onSwitch:(id:string)=>void;onCreate:(name:string,currency:string)=>Promise<void>;onJoin:(code:string)=>Promise<void>;onDelete:(id:string)=>Promise<void>;onLeave:(id:string)=>Promise<void>}) {
  const[name,setName]=useState("");const[code,setCode]=useState("");const[currency,setCurrency]=useState("BDT");
  const[pendingDelete,setPendingDelete]=useState<{id:string;name:string}|null>(null);const[confirmation,setConfirmation]=useState("");const[deleting,setDeleting]=useState(false);
  const[pendingLeave,setPendingLeave]=useState<{id:string;name:string}|null>(null);const[leaving,setLeaving]=useState(false);
  const[creating,setCreating]=useState(false);const[joining,setJoining]=useState(false);const[now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(creationCooldownUntil<=Date.now())return;const timer=window.setInterval(()=>setNow(Date.now()),250);return()=>window.clearInterval(timer);},[creationCooldownUntil]);
  const remaining=Math.max(0,Math.ceil((creationCooldownUntil-now)/1000));
  const create=async()=>{if(creating||remaining>0||name.trim().length<2)return;try{setCreating(true);await onCreate(name.trim(),currency);setName("");}finally{setCreating(false);}};
  const join=async()=>{if(joining||code.length<6)return;try{setJoining(true);await onJoin(code);setCode("");}finally{setJoining(false);}};
  const confirmDelete=async()=>{if(!pendingDelete||confirmation!=="delete")return;try{setDeleting(true);await onDelete(pendingDelete.id);setPendingDelete(null);setConfirmation("");}finally{setDeleting(false);}};
  const confirmLeave=async()=>{if(!pendingLeave)return;try{setLeaving(true);await onLeave(pendingLeave.id);setPendingLeave(null);}finally{setLeaving(false);}};
  return <><div className="two-column"><section className="page-card"><div className="section-heading"><div><h2>Your households</h2><p>Select, leave, or permanently delete a household.</p></div></div><div className="household-grid">{data.households.map((household)=><article key={household.id} className={household.id===activeId?"active":""}><button className="household-card-main" onClick={()=>onSwitch(household.id)}><Home/><div><b>{household.name}</b><span>{household.currency} · {household.id===activeId?"Currently selected":"Shared household"}</span></div>{household.id===activeId&&<Check/>}</button><div className="household-card-actions"><button className="household-leave" onClick={()=>setPendingLeave({id:household.id,name:household.name})}><LogOut/><span>Leave</span></button><button className="household-delete" onClick={()=>{setPendingDelete({id:household.id,name:household.name});setConfirmation("");}}><Trash2/><span>Delete</span></button></div></article>)}</div></section><aside className="page-card household-actions"><h2>Add another household</h2><Field label="New household name"><Input value={name} disabled={creating} onChange={(event)=>setName(event.target.value)} placeholder="e.g. Office lunch group"/></Field><Field label="Currency"><Select value={currency} onValueChange={setCurrency} disabled={creating}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{["BDT","USD","GBP","EUR","INR"].map((item)=><SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field><Button disabled={creating||remaining>0||name.trim().length<2} onClick={()=>void create()}>{creating?<RefreshCw className="spin"/>:<Plus/>}{creating?"Creating…":remaining>0?`Wait ${remaining}s`:"Create household"}</Button><small className="creation-safety-note">New household creation is protected by a 10-second duplicate-prevention lock.</small><div className="or-line"><span>or join with a code</span></div><div className="join-row"><Input value={code} disabled={joining} onChange={(event)=>setCode(event.target.value.toUpperCase())} placeholder="Invite code"/><Button variant="outline" disabled={joining||code.length<6} onClick={()=>void join()}>{joining?"Joining…":"Join"}</Button></div></aside></div>
    <AlertDialog open={Boolean(pendingLeave)} onOpenChange={(open)=>{if(!open&&!leaving)setPendingLeave(null);}}><AlertDialogContent><AlertDialogHeader><span className="leave-dialog-icon"><LogOut/></span><AlertDialogTitle>Leave {pendingLeave?.name}?</AlertDialogTitle><AlertDialogDescription>You will lose access to this household, but its expenses and history will remain for the other members. Your balance must be settled before you can leave. Recurring bills involving you will be paused.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={leaving}>Cancel</AlertDialogCancel><AlertDialogAction className="leave-confirm-action" disabled={leaving} onClick={(event)=>{event.preventDefault();void confirmLeave();}}>{leaving?<RefreshCw className="spin"/>:<LogOut/>}{leaving?"Leaving…":"Leave household"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={Boolean(pendingDelete)} onOpenChange={(open)=>{if(!open&&!deleting){setPendingDelete(null);setConfirmation("");}}}><DialogContent className="form-dialog compact delete-household-dialog"><DialogHeader><span className="danger-dialog-icon"><TriangleAlert/></span><DialogTitle>Delete {pendingDelete?.name}?</DialogTitle><DialogDescription>This permanently deletes the household for every member, including all expenses, settlements, recurring bills, receipts, profile photos, and history. This cannot be undone.</DialogDescription></DialogHeader><div className="delete-confirmation"><p>Type <b>delete</b> to confirm.</p><Input value={confirmation} onChange={(event)=>setConfirmation(event.target.value)} placeholder="delete" autoComplete="off" spellCheck={false} autoFocus/></div><div className="delete-dialog-actions"><Button variant="outline" disabled={deleting} onClick={()=>{setPendingDelete(null);setConfirmation("");}}>Cancel</Button><Button variant="destructive" disabled={deleting||confirmation!=="delete"} onClick={()=>void confirmDelete()}>{deleting?<RefreshCw className="spin"/>:<Trash2/>}{deleting?"Deleting…":"Delete household"}</Button></div></DialogContent></Dialog>
  </>;
}

function EmptyState({icon,title,copy,action}:{icon:React.ReactNode;title:string;copy:string;action?:()=>void}) { return <div className="empty-state"><span>{icon}</span><h3>{title}</h3><p>{copy}</p>{action&&<Button variant="outline" size="sm" onClick={action}><Plus/>Add now</Button>}</div>; }

function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="form-field"><span>{label}</span>{children}</label>; }

function ExpenseDialog({open,onOpenChange,active,onSave}:{open:boolean;onOpenChange:(v:boolean)=>void;active:ActiveData;onSave:(p:Record<string,unknown>,f:File|null)=>Promise<void>}) {
  const currentMember=active.members.find((member)=>member.id===active.currentMemberId)!;
  const availableCategories=categories.filter((item)=>isCategoryApplicable(currentMember.applicable_categories,item));
  const initialCategory=availableCategories[0]??"Other";
  const initialEligible=eligibleMembers(active.members,initialCategory);
  const [description,setDescription]=useState(""); const [amount,setAmount]=useState(""); const [category,setCategory]=useState(initialCategory); const [date,setDate]=useState(today()); const [payer,setPayer]=useState(String(active.currentMemberId)); const [splitType,setSplitType]=useState("equal"); const [participants,setParticipants]=useState<number[]>(initialEligible.map((m)=>Number(m.id))); const [shares,setShares]=useState<Record<string,string>>({}); const [notes,setNotes]=useState(""); const [file,setFile]=useState<File|null>(null); const [busy,setBusy]=useState(false); const [useRecurring,setUseRecurring]=useState(false); const [templateId,setTemplateId]=useState("");
  const recurringOptions=active.recurring.filter((item)=>availableCategories.includes(item.category));
  const chooseCategory=(next:string)=>{setCategory(next);const nextEligible=eligibleMembers(active.members,next);setParticipants(nextEligible.map((member)=>member.id));setShares({});if(!nextEligible.some((member)=>String(member.id)===payer))setPayer(String(nextEligible[0]?.id??""));};
  const applyTemplate=(id:string)=>{setTemplateId(id);const template=recurringOptions.find((item)=>item.id===id);if(!template)return;setDescription(template.description);setAmount(String(template.amount_cents/100));setCategory(template.category);const permitted=eligibleMembers(active.members,template.category);setPayer(permitted.some((member)=>member.id===Number(template.paid_by_member_id))?String(template.paid_by_member_id):String(permitted[0]?.id??""));try{const ids=JSON.parse(template.participant_ids) as number[];setParticipants(ids.map(Number).filter((memberId)=>permitted.some((member)=>member.id===memberId)));}catch{setParticipants(permitted.map((member)=>member.id));}};
  const startFromScratch=()=>{setUseRecurring(false);setTemplateId("");setDescription("");setAmount("");setCategory(initialCategory);setPayer(String(active.currentMemberId));setSplitType("equal");setParticipants(initialEligible.map((member)=>Number(member.id)));setShares({});};
  const customTotal=Object.values(shares).reduce((s,v)=>s+(Number(v)||0),0); const valid=description.trim()&&Number(amount)>0&&participants.length>0&&(splitType==="equal"||Math.abs(customTotal-Number(amount))<0.001);
  const submit=async()=>{try{setBusy(true);await onSave({description,amount:Number(amount),category,expenseDate:date,paidByMemberId:Number(payer),splitType,participantIds:participants,customShares:shares,notes},file);startFromScratch();setNotes("");setFile(null);}finally{setBusy(false);}};
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>Add an expense</DialogTitle><DialogDescription>Record who paid and exactly how the cost should be shared.</DialogDescription></DialogHeader>{recurringOptions.length>0&&<div className="recurring-template"><label className="recurring-template-toggle" htmlFor="use-recurring-template"><Checkbox id="use-recurring-template" checked={useRecurring} onCheckedChange={(checked)=>{if(checked){setUseRecurring(true);}else{startFromScratch();}}}/><span><b>Use a recurring bill</b><small>Fill this expense from one of your saved bills</small></span></label>{useRecurring&&<Field label="Saved recurring bill"><Select value={templateId} onValueChange={applyTemplate}><SelectTrigger><SelectValue placeholder="Choose a saved recurring bill"/></SelectTrigger><SelectContent>{recurringOptions.map((item)=><SelectItem key={item.id} value={item.id}>{item.category} · {item.description}</SelectItem>)}</SelectContent></Select></Field>}</div>}<div className="form-grid"><Field label="Description"><Input value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="Weekly groceries" autoFocus/></Field><Field label="Amount"><div className="money-input"><span>{active.household.currency==="BDT"?"৳":active.household.currency}</span><Input type="number" min="0" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} placeholder="0.00"/></div></Field><Field label="Category"><Select value={category} onValueChange={chooseCategory}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{availableCategories.map((c)=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field><Field label="Date"><Input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></Field><Field label="Paid by"><Select value={payer} onValueChange={setPayer}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{eligibleMembers(active.members,category).map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field><Field label="Split method"><Select value={splitType} onValueChange={setSplitType}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="equal">Split equally</SelectItem><SelectItem value="custom">Exact amounts</SelectItem></SelectContent></Select></Field></div><div className="participants"><div><span>Split between</span><small>{participants.length} selected</small></div>{active.members.map((m)=>{const checked=participants.includes(Number(m.id));const eligible=isCategoryApplicable(m.applicable_categories,category);return <div className={`participant-row ${eligible?"":"ineligible"}`} key={m.id}><Checkbox disabled={!eligible} checked={checked} onCheckedChange={()=>setParticipants(checked?participants.filter((id)=>id!==Number(m.id)):[...participants,Number(m.id)])}/><span className="member-avatar tiny">{initials(m.display_name)}</span><b>{m.display_name}</b>{!eligible?<small>Not applicable</small>:splitType==="custom"&&checked?<div className="share-input"><span>{active.household.currency==="BDT"?"৳":""}</span><Input type="number" step="0.01" value={shares[String(m.id)]||""} onChange={(e)=>setShares({...shares,[String(m.id)]:e.target.value})}/></div>:checked&&<small>{amount?formatMoney(Math.round(Number(amount)*100/participants.length),active.household.currency):"—"}</small>}</div>})}{splitType==="custom"&&<div className={`split-check ${Math.abs(customTotal-Number(amount))<0.001?"ok":""}`}><span>Assigned {formatMoney(Math.round(customTotal*100),active.household.currency)}</span><b>{Math.abs(customTotal-Number(amount))<0.001?"Balanced":`${formatMoney(Math.round(Math.abs(Number(amount)-customTotal)*100),active.household.currency)} remaining`}</b></div>}</div><Field label="Notes (optional)"><Input value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Anything your housemates should know"/></Field><Field label="Receipt (optional)"><Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e)=>setFile(e.target.files?.[0]||null)}/></Field><Button className="wide-button" disabled={!valid||busy} onClick={submit}>{busy?<RefreshCw className="spin"/>:<Plus/>}Add expense</Button></DialogContent></Dialog>;
}

function SettlementDialog({open,onOpenChange,active,suggestion,onSave}:{open:boolean;onOpenChange:(v:boolean)=>void;active:ActiveData;suggestion:Suggestion|null;onSave:(p:Record<string,unknown>)=>Promise<void>}) { const [from,setFrom]=useState(String(suggestion?.fromMemberId ?? active.currentMemberId));const [to,setTo]=useState(suggestion?String(suggestion.toMemberId):"");const [amount,setAmount]=useState(suggestion?String(suggestion.amountCents/100):"");const [date,setDate]=useState(today());const [notes,setNotes]=useState("");const [busy,setBusy]=useState(false);const submit=async()=>{try{setBusy(true);await onSave({fromMemberId:Number(from),toMemberId:Number(to),amount:Number(amount),settlementDate:date,notes});}finally{setBusy(false);}};return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog compact"><DialogHeader><DialogTitle>Record a payment</DialogTitle><DialogDescription>This reduces the outstanding balance between two members.</DialogDescription></DialogHeader><div className="payment-form"><Field label="Paid by"><Select value={from} onValueChange={setFrom}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{active.members.map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field><ArrowUpRight/><Field label="Paid to"><Select value={to} onValueChange={setTo}><SelectTrigger><SelectValue placeholder="Choose member"/></SelectTrigger><SelectContent>{active.members.filter((m)=>String(m.id)!==from).map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field></div><Field label="Amount"><div className="money-input"><span>{active.household.currency==="BDT"?"৳":active.household.currency}</span><Input type="number" min="0" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)}/></div></Field><Field label="Payment date"><Input type="date" value={date} onChange={(e)=>setDate(e.target.value)}/></Field><Field label="Note (optional)"><Input value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Bank transfer, cash…"/></Field><Button className="wide-button" disabled={!from||!to||Number(amount)<=0||busy} onClick={submit}>{busy?<RefreshCw className="spin"/>:<Check/>}Record settlement</Button></DialogContent></Dialog>; }

function RecurringDialog({open,onOpenChange,active,onSave}:{open:boolean;onOpenChange:(v:boolean)=>void;active:ActiveData;onSave:(p:Record<string,unknown>)=>Promise<void>}) {
  const currentMember=active.members.find((member)=>member.id===active.currentMemberId)!;
  const availableCategories=categories.filter((item)=>isCategoryApplicable(currentMember.applicable_categories,item));
  const initialCategory=availableCategories[0]??"Other";
  const initialEligible=eligibleMembers(active.members,initialCategory);
  const [description,setDescription]=useState("");const [amount,setAmount]=useState("");const [category,setCategory]=useState(initialCategory);const [payer,setPayer]=useState(String(active.currentMemberId));const [cadence,setCadence]=useState("monthly");const [due,setDue]=useState(today());const [participants,setParticipants]=useState<number[]>(initialEligible.map((m)=>Number(m.id)));const [busy,setBusy]=useState(false);
  const chooseCategory=(next:string)=>{setCategory(next);const permitted=eligibleMembers(active.members,next);setParticipants(permitted.map((member)=>member.id));if(!permitted.some((member)=>String(member.id)===payer))setPayer(String(permitted[0]?.id??""));};
  const submit=async()=>{try{setBusy(true);await onSave({description,amount:Number(amount),category,paidByMemberId:Number(payer),cadence,nextDueDate:due,participantIds:participants});setDescription("");setAmount("");}finally{setBusy(false);}};
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="form-dialog"><DialogHeader><DialogTitle>New recurring bill</DialogTitle><DialogDescription>Save the template, then post it whenever the bill is due.</DialogDescription></DialogHeader><div className="form-grid"><Field label="Bill name"><Input value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="Monthly internet"/></Field><Field label="Expected amount"><div className="money-input"><span>{active.household.currency==="BDT"?"৳":active.household.currency}</span><Input type="number" value={amount} onChange={(e)=>setAmount(e.target.value)}/></div></Field><Field label="Category"><Select value={category} onValueChange={chooseCategory}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{availableCategories.map((c)=><SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></Field><Field label="Paid by"><Select value={payer} onValueChange={setPayer}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{eligibleMembers(active.members,category).map((m)=><SelectItem key={m.id} value={String(m.id)}>{m.display_name}</SelectItem>)}</SelectContent></Select></Field><Field label="Frequency"><Select value={cadence} onValueChange={setCadence}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Every 3 months</SelectItem></SelectContent></Select></Field><Field label="Next due"><Input type="date" value={due} onChange={(e)=>setDue(e.target.value)}/></Field></div><div className="participants"><div><span>Shared by</span><small>{participants.length} selected</small></div>{active.members.map((m)=>{const checked=participants.includes(Number(m.id));const eligible=isCategoryApplicable(m.applicable_categories,category);return <div className={`participant-row ${eligible?"":"ineligible"}`} key={m.id}><Checkbox disabled={!eligible} checked={checked} onCheckedChange={()=>setParticipants(checked?participants.filter((id)=>id!==Number(m.id)):[...participants,Number(m.id)])}/><span className="member-avatar tiny">{initials(m.display_name)}</span><b>{m.display_name}</b>{!eligible&&<small>Not applicable</small>}</div>})}</div><Button className="wide-button" disabled={!description||Number(amount)<=0||!participants.length||busy} onClick={submit}>{busy?<RefreshCw className="spin"/>:<Repeat2/>}Save recurring bill</Button></DialogContent></Dialog>;
}
