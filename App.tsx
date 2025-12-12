import React, { useState, useRef, useEffect } from 'react';
import { 
  UploadCloud, 
  FileText, 
  PenTool, 
  UserCheck, 
  Sparkles, 
  CheckCircle2,
  Database,
  BrainCircuit,
  MessageSquare,
  AlertCircle,
  Loader2,
  Heart,
  Zap,
  Building2,
  Briefcase
} from 'lucide-react';
import { AppMode, ParsedResume, CopilotAction, FileData, EnrichedCorpusItem, ChatMessage } from './types';
import { 
  parseResumeWithGemini, 
  generateRichCorpus, 
  enrichAndEmbedCorpus, 
  getRagContext,
  JobAppCopilot,
  tailorResume,
  generateLatex,
  generateMarkdown
} from './services/geminiService';
import { Button, Card, LoadingOverlay, ChatBubble, ChatInput, ResumePreview } from './components/Layout';

// --- LIMIT CONSTANTS ---
const MAX_SESSION_TOKENS = 200000;

// Main App Component
const App: React.FC = () => {
  // --- STATE ---
  const [mode, setMode] = useState<AppMode>(AppMode.UPLOAD);
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [parsedResume, setParsedResume] = useState<ParsedResume | null>(null);
  
  // Usage State
  const [tokenUsage, setTokenUsage] = useState<number>(0);
  
  // Vector DB
  const [vectorStore, setVectorStore] = useState<EnrichedCorpusItem[]>([]);
  const [isIndexing, setIsIndexing] = useState<boolean>(false);
  const [indexingProgress, setIndexingProgress] = useState<number>(0);

  // Job Context
  const [jobDescription, setJobDescription] = useState<string>('');
  const [targetCompany, setTargetCompany] = useState<string>('');
  const [targetRole, setTargetRole] = useState<string>('');
  
  // Chat / Copilot State
  const [activeTab, setActiveTab] = useState<CopilotAction>(CopilotAction.COVER_LETTER);
  const copilotRef = useRef<JobAppCopilot | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Tailored Resume State
  const [tailoredResumeData, setTailoredResumeData] = useState<ParsedResume | null>(null);
  
  // Global UI
  const [isLoading, setIsLoading] = useState<boolean>(false); // For full screen loading
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  // --- HELPERS ---

  const handleTokenUsage = (newTokens: number) => {
    setTokenUsage(prev => {
      const next = prev + newTokens;
      if (next >= MAX_SESSION_TOKENS) {
         setError("Session token limit reached. Please reload to start a fresh session.");
      }
      return next;
    });
  };

  // --- HANDLERS ---

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Robust File Type Check
    const isPdf = file.type === 'application/pdf';
    const isText = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
    const isMd = file.name.toLowerCase().endsWith('.md');
    const isTex = file.name.toLowerCase().endsWith('.tex');

    if (!isPdf && !isText && !isMd && !isTex) {
      setError("Unsupported format. Please upload PDF, TXT, MD, or TEX files.");
      return;
    }

    setIsLoading(true);
    setLoadingMessage("Reading file...");
    setError(null);
    setTokenUsage(0); // Reset tokens for new resume

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = e.target?.result as string;
        
        // Infer MimeType if missing (common for .md/.tex on some OS)
        let mimeType = file.type;
        if (!mimeType) {
           if (isPdf) mimeType = 'application/pdf';
           else if (isMd) mimeType = 'text/plain'; // Treat MD as text for extraction
           else if (isTex) mimeType = 'text/plain'; // Treat TEX as text for extraction
           else mimeType = 'text/plain';
        }

        const base64Data = result.split(',')[1];
        
        setFileData({
          base64: base64Data,
          mimeType: mimeType,
          name: file.name
        });

        setLoadingMessage("Parsing resume with Gemini Flash 2.5...");
        try {
          const parsed = await parseResumeWithGemini(base64Data, mimeType, handleTokenUsage);
          
          setParsedResume(parsed);
          setMode(AppMode.DASHBOARD);
          setIsLoading(false);
          
          buildKnowledgeBase(parsed); // Start indexing in background

        } catch (err: any) {
          console.error("Parsing Error:", err);
          setError(`Parsing failed: ${err.message || "Unknown error"}. Please check your API key.`);
          setIsLoading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError("Error reading file from disk.");
      setIsLoading(false);
    }
  };

  const buildKnowledgeBase = async (parsed: ParsedResume) => {
    if (tokenUsage >= MAX_SESSION_TOKENS) return;

    setIsIndexing(true);
    setIndexingProgress(0);
    try {
      const rawCorpus = generateRichCorpus(parsed);
      const enriched = await enrichAndEmbedCorpus(
          rawCorpus, 
          (current, total) => {
             setIndexingProgress(Math.round((current / total) * 100));
          },
          handleTokenUsage
      );
      setVectorStore(enriched);
    } catch (e) {
      console.error("Indexing failed", e);
      setError("Failed to build knowledge base. Features may be limited.");
    } finally {
      setIsIndexing(false);
    }
  };

  const initCopilotSession = async (action: CopilotAction) => {
    if (tokenUsage >= MAX_SESSION_TOKENS) {
       setError("Session token limit exceeded. Please reload.");
       return;
    }

    if (!jobDescription.trim()) {
      setError("Please enter a job description first.");
      return;
    }
    if (!parsedResume) {
       setError("Resume data missing. Please re-upload.");
       return;
    }

    const company = targetCompany.trim() || "the hiring company";
    const role = targetRole.trim() || "the open position";

    // SPECIAL HANDLING FOR TAILOR RESUME (No chat, direct generation)
    if (action === CopilotAction.TAILOR_RESUME) {
        setIsLoading(true);
        setLoadingMessage("Tailoring resume based on JD...");
        try {
            const tailored = await tailorResume(parsedResume, jobDescription, [], company, role, handleTokenUsage);
            setTailoredResumeData(tailored);
        } catch(e: any) {
            setError(`Failed to tailor resume: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
        return;
    }

    // CHAT BOT HANDLING
    if (vectorStore.length === 0 && !isIndexing) {
      setError("Resume data missing. Please re-upload.");
      return;
    }
    if (isIndexing) {
      setError("Still indexing resume. Please wait...");
      return;
    }

    setError(null);
    setIsChatLoading(true);
    setChatHistory([]); // Reset chat for new session
    
    try {
      // 1. Get Evidence via RAG
      const evidence = await getRagContext(jobDescription, vectorStore, {
        requirementCount: 5,
        reqMatchCount: 5
      }, handleTokenUsage);
      
      const requirements = ["(See extracted requirements in context)"]; 

      const copilot = new JobAppCopilot(jobDescription, evidence, requirements, company, role, handleTokenUsage);
      copilotRef.current = copilot;

      // 3. Trigger Initial Action
      if (action === CopilotAction.COVER_LETTER) {
        const draft = await copilot.draftCoverLetter();
        setChatHistory([{
          id: Date.now().toString(),
          role: 'model',
          text: draft,
          timestamp: Date.now()
        }]);
      } else if (action === CopilotAction.INTERVIEW_PREP) {
        // Q&A Mode
        await copilot.startQuestionMode();
        setChatHistory([{
          id: Date.now().toString(),
          role: 'model',
          text: `I'm ready to help you prepare for the **${role}** role at **${company}**. You can ask me generic interview questions or paste specific questions from the portal.`,
          timestamp: Date.now()
        }]);
      } 
    } catch (e) {
      console.error(e);
      setError("Failed to initialize Copilot session.");
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSendMessage = async (text: string) => {
    if (tokenUsage >= MAX_SESSION_TOKENS) {
        setError("Token limit exceeded.");
        return;
    }
    if (!copilotRef.current) return;

    // Optimistic Update
    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text, timestamp: Date.now() };
    setChatHistory(prev => [...prev, userMsg]);
    setIsChatLoading(true);

    try {
      const responseText = await copilotRef.current.sendMessage(text);
      const aiMsg: ChatMessage = { id: (Date.now()+1).toString(), role: 'model', text: responseText, timestamp: Date.now() };
      setChatHistory(prev => [...prev, aiMsg]);
    } catch (e) {
      setError("Failed to send message.");
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleTabChange = (tab: CopilotAction) => {
    setActiveTab(tab);
    setChatHistory([]); 
    copilotRef.current = null; 
    setTailoredResumeData(null); // Reset tailored view
  };

  const downloadTex = () => {
      if(!tailoredResumeData) return;
      const tex = generateLatex(tailoredResumeData);
      const blob = new Blob([tex], { type: 'application/x-tex' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tailored_Resume_${tailoredResumeData.contact_info.full_name.replace(/\s+/g, '_')}.tex`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
      if(!tailoredResumeData) return;
      const jsonStr = JSON.stringify(tailoredResumeData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tailored_Resume.json`;
      a.click();
      URL.revokeObjectURL(url);
  };

  const downloadMd = () => {
    if(!tailoredResumeData) return;
    const md = generateMarkdown(tailoredResumeData);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Tailored_Resume.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- RENDER HELPERS ---

  const renderUploadScreen = () => (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans">
      
      {/* Hero Section with Background Image */}
      <div className="relative w-full h-[55vh] min-h-[500px] flex items-center justify-center overflow-hidden">
        {/* Winter Background */}
        <img 
           src="https://images.unsplash.com/photo-1483664852095-d6cc6870702d?q=80&w=2070&auto=format&fit=crop"
           alt="Cozy Winter Landscape"
           className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Overlay to ensure text readability */}
        <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]"></div>
        
        {/* Hero Content */}
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto text-white space-y-8 mt-[-40px]">
           <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 backdrop-blur-md rounded-3xl mb-2 border border-white/20 shadow-2xl animate-in fade-in zoom-in duration-700">
              <Sparkles className="w-10 h-10 text-indigo-200" />
           </div>
           
           <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight text-white drop-shadow-sm">
             JobAlign Copilot
           </h1>
           
           <p className="text-xl text-indigo-100 max-w-2xl mx-auto leading-relaxed font-light">
             Your intelligent career companion, built with Gemini. We tailor your resume, craft compelling cover letters, and prepare you for interviews.
           </p>

           <div className="flex flex-col items-center gap-3 mt-4 text-indigo-100 bg-white/10 backdrop-blur-md p-6 rounded-2xl border border-white/10 max-w-2xl mx-auto shadow-lg">
              <div className="flex items-center gap-2 text-indigo-300">
                  <Heart className="w-5 h-5 fill-current animate-pulse" />
                  <span className="text-sm font-bold uppercase tracking-wider">Your Career Matters</span>
              </div>
              <p className="text-base italic text-slate-50/90 leading-relaxed">
                 "Everyone has unique strengths. We don't invent facts, we illuminate your best skills to match the job you deserve."
              </p>
           </div>
        </div>
      </div>

      {/* Upload Section - Overlapping the Hero */}
      <div className="flex-1 flex flex-col items-center px-4 -mt-24 pb-12 relative z-20">
         <div className="w-full max-w-xl">
             {/* Upload Card */}
             <div className="bg-white rounded-2xl shadow-2xl border border-indigo-50 p-2 transform hover:-translate-y-1 transition-transform duration-300">
                <div 
                  className="border-2 border-dashed border-indigo-100 rounded-xl bg-indigo-50/30 hover:bg-indigo-50 hover:border-indigo-400 transition-all cursor-pointer group py-12 px-8 text-center"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="w-16 h-16 rounded-full bg-indigo-100 group-hover:bg-indigo-200 flex items-center justify-center mx-auto mb-5 transition-colors">
                    <UploadCloud className="w-8 h-8 text-indigo-700" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-2">Upload Your Resume</h3>
                  
                  <p className="text-slate-500 mb-8 max-w-sm mx-auto text-sm leading-relaxed">
                     <span className="font-semibold text-indigo-600 block mb-1">💡 Pro Tip:</span>
                     Upload a comprehensive <strong>"Master Resume"</strong> or CV (PDF/TXT/MD). The more history you provide, the better we can tailor it to specific roles!
                  </p>
                  
                  <Button disabled={isLoading} className="w-full max-w-xs shadow-lg shadow-indigo-200 py-3 text-lg">
                    {isLoading ? (
                       <span className="flex items-center gap-2">
                         <Loader2 className="w-5 h-5 animate-spin" /> Processing...
                       </span>
                    ) : 'Select Resume File'}
                  </Button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept=".pdf,.txt,.md,.tex" 
                    onChange={handleFileUpload}
                  />
                </div>
             </div>
             
             {error && (
                <div className="mt-6 p-4 bg-red-50 text-red-700 rounded-xl flex items-center justify-center gap-2 text-sm font-medium border border-red-100 shadow-sm animate-in fade-in slide-in-from-bottom-2">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  {error}
                </div>
             )}
         </div>
      </div>
    </div>
  );

  const renderDashboard = () => (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl text-slate-900 hidden sm:inline">JobAlign</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
             {/* Token Usage Pill */}
             <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                 tokenUsage > MAX_SESSION_TOKENS * 0.9 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'
             }`}>
                <Zap className="w-3 h-3" />
                <span className="hidden sm:inline">Session Usage:</span>
                {Math.round(tokenUsage / 1000)}k / {MAX_SESSION_TOKENS / 1000}k
             </div>

             {isIndexing ? (
               <div className="flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full animate-pulse">
                 <BrainCircuit className="w-3 h-3" />
                 <span className="hidden sm:inline">Building KB ({indexingProgress}%)</span>
               </div>
             ) : vectorStore.length > 0 ? (
               <div className="flex items-center gap-2 text-xs text-green-600 bg-green-50 px-3 py-1 rounded-full">
                 <Database className="w-3 h-3" />
                 <span className="hidden sm:inline">RAG Ready</span>
               </div>
             ) : null}
             
             <div className="text-sm text-slate-500 hidden md:block truncate max-w-[150px]">
               {fileData?.name}
             </div>
             <Button variant="outline" onClick={() => setMode(AppMode.UPLOAD)} className="text-xs h-8">
               Change Resume
             </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Context & Inputs */}
        <div className="lg:col-span-4 space-y-6">
          {/* Resume Summary Card */}
          <Card title="Parsed Profile">
            <div className="space-y-4">
               <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Summary</h4>
                  <p className="text-sm text-slate-700 leading-relaxed line-clamp-4 hover:line-clamp-none transition-all">{parsedResume?.professional_summary}</p>
               </div>
               
               {/* Skills */}
               <div>
                  <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Skills</h4>
                  <div className="flex flex-wrap gap-2">
                    {parsedResume?.skills.slice(0, 4).map((group, i) => (
                      <React.Fragment key={i}>
                        {group.items.slice(0, 3).map((skill, j) => (
                           <span key={`${i}-${j}`} className="inline-flex items-center px-2 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-medium">
                            {skill}
                          </span>
                        ))}
                      </React.Fragment>
                    ))}
                    <span className="text-xs text-slate-400 self-center">...</span>
                  </div>
               </div>
            </div>
          </Card>

          {/* Job Description Input - UPDATED */}
          <Card title="Target Job" subtitle="Enter the job details to start generating content.">
            <div className="space-y-4">
              
              {/* Added: Company and Role Inputs */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                 <div className="space-y-1">
                   <label className="text-xs font-semibold text-slate-500 ml-1">Company Name</label>
                   <div className="relative">
                      <Building2 className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="e.g. Acme Corp"
                        value={targetCompany}
                        onChange={(e) => setTargetCompany(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                   </div>
                 </div>
                 <div className="space-y-1">
                   <label className="text-xs font-semibold text-slate-500 ml-1">Target Role</label>
                   <div className="relative">
                      <Briefcase className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="e.g. Senior Developer"
                        value={targetRole}
                        onChange={(e) => setTargetRole(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                   </div>
                 </div>
              </div>

              <div className="space-y-1">
                 <label className="text-xs font-semibold text-slate-500 ml-1">Job Description Text</label>
                 <textarea
                   className="w-full h-[400px] p-4 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none placeholder-slate-400"
                   placeholder="Paste the full job description here..."
                   value={jobDescription}
                   onChange={(e) => {
                     setJobDescription(e.target.value);
                     setError(null);
                   }}
                 />
              </div>
              
              <div className="text-xs text-slate-500 flex justify-between">
                <span>{jobDescription.length} characters</span>
                {jobDescription.length > 50 && <span className="text-green-600 font-medium">Ready to analyze</span>}
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Chat Interface OR Resume Preview */}
        <div className="lg:col-span-8 space-y-6 flex flex-col h-full min-h-[600px]">
          
          {/* Action Tabs */}
          <div className="flex p-1 bg-white border border-slate-200 rounded-lg shadow-sm w-fit">
            {[
              { id: CopilotAction.COVER_LETTER, label: 'Draft Cover Letter', icon: <PenTool className="w-4 h-4" /> },
              { id: CopilotAction.INTERVIEW_PREP, label: 'Application Q&A', icon: <UserCheck className="w-4 h-4" /> },
              { id: CopilotAction.TAILOR_RESUME, label: 'Tailor Resume', icon: <FileText className="w-4 h-4" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-indigo-50 text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Error Banner */}
          {error && (
             <div className="bg-red-50 border border-red-100 text-red-700 px-4 py-3 rounded-lg flex items-start gap-3">
               <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
               <p className="text-sm">{error}</p>
             </div>
          )}

          {/* CONTENT AREA: Either Chat OR Resume Preview */}
          <Card noPadding className="flex-1 flex flex-col relative overflow-hidden border-slate-200 shadow-md">
            
            {/* 1. TAILOR RESUME VIEW */}
            {activeTab === CopilotAction.TAILOR_RESUME && tailoredResumeData ? (
                 <ResumePreview 
                    resume={tailoredResumeData} 
                    onDownloadTex={downloadTex} 
                    onDownloadJson={downloadJson}
                    onDownloadMd={downloadMd}
                 />
            ) : (
            // 2. CHAT VIEW
            <>
                {/* Header / Start Button Overlay */}
                {chatHistory.length === 0 && !tailoredResumeData && (
                  <div className="absolute inset-0 z-10 bg-white flex flex-col items-center justify-center text-center p-8 space-y-6">
                    <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center">
                        <MessageSquare className="w-8 h-8 text-indigo-600" />
                    </div>
                    <div className="max-w-md space-y-2">
                      <h3 className="text-xl font-bold text-slate-900">
                        {activeTab === CopilotAction.TAILOR_RESUME ? "Resume Tailoring Agent" : 
                         activeTab === CopilotAction.COVER_LETTER ? "Expert Cover Letter Drafter" : 
                         "Application Question Assistant"}
                      </h3>
                      <p className="text-slate-500 text-sm">
                        {activeTab === CopilotAction.TAILOR_RESUME 
                          ? "I will intelligently rewrite your bullet points to match the JD keywords and generate a ready-to-compile LaTeX file."
                          : activeTab === CopilotAction.COVER_LETTER 
                            ? "I will analyze your resume against the JD to write a persuasive, evidence-based cover letter."
                            : "Paste a question from the application portal, and I'll use the STAR method to draft a tailored response."}
                      </p>
                    </div>
                    <Button 
                      onClick={() => initCopilotSession(activeTab)} 
                      disabled={isChatLoading || !jobDescription}
                      className="shadow-lg shadow-indigo-200"
                    >
                      {isChatLoading ? "Initializing..." : activeTab === CopilotAction.TAILOR_RESUME ? "Tailor My Resume" : "Start Session"}
                    </Button>
                    {!jobDescription && (
                        <p className="text-xs text-amber-600 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Job Description required
                        </p>
                    )}
                  </div>
                )}

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-50/50" ref={chatContainerRef}>
                  {chatHistory.map((msg) => (
                    <ChatBubble key={msg.id} role={msg.role} text={msg.text} />
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start w-full mb-4">
                      <div className="flex items-center gap-2 bg-white px-4 py-3 rounded-2xl rounded-tl-none border border-slate-100 shadow-sm">
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                          <span className="text-xs text-slate-500 font-medium">Thinking...</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input Area (Only for Chat modes) */}
                {activeTab !== CopilotAction.TAILOR_RESUME && (
                  <div className="p-4 bg-white border-t border-slate-100">
                    <ChatInput 
                      onSend={handleSendMessage} 
                      disabled={isChatLoading || chatHistory.length === 0}
                      placeholder={activeTab === CopilotAction.INTERVIEW_PREP ? "Paste a question or ask for adjustments..." : "Ask for refinements (e.g., 'Make it shorter')..."}
                    />
                  </div>
                )}
            </>
            )}
          </Card>

        </div>
      </main>
      
      {isLoading && <LoadingOverlay message={loadingMessage} />}
    </div>
  );

  return mode === AppMode.UPLOAD ? renderUploadScreen() : renderDashboard();
};

export default App;