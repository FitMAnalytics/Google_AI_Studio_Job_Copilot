import React, { useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, User, Bot, Send, Download, FileJson, FileText, Eye, Code } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { ParsedResume } from '../types';
import { generateMarkdown } from '../services/geminiService';

export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'outline' | 'ghost', isLoading?: boolean }> = ({ 
  children, 
  variant = 'primary', 
  isLoading, 
  className = '', 
  disabled,
  ...props 
}) => {
  const baseStyle = "inline-flex items-center justify-center px-4 py-2 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-500 shadow-sm",
    secondary: "bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500 shadow-sm",
    outline: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-400",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-100 focus:ring-slate-400",
  };

  return (
    <button 
      className={`${baseStyle} ${variants[variant]} ${className}`} 
      disabled={isLoading || disabled}
      {...props}
    >
      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </button>
  );
};

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string | React.ReactNode; subtitle?: string }> = ({ children, className = '', title, subtitle }) => (
  <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
    {title && (
      <div className="px-6 py-4 border-b border-slate-100">
        <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">{title}</h3>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
    )}
    <div className="p-6">{children}</div>
  </div>
);

export const SectionHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = ({ title, subtitle, icon }) => (
  <div className="mb-6">
    <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
      {icon}
      {title}
    </h2>
    {subtitle && <p className="text-slate-500 mt-1">{subtitle}</p>}
  </div>
);

export const LoadingOverlay: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center rounded-xl animate-in fade-in duration-300">
    <Loader2 className="w-10 h-10 text-indigo-600 animate-spin mb-4" />
    <p className="text-indigo-900 font-medium animate-pulse">{message}</p>
  </div>
);

// --- CHAT COMPONENTS ---

export const ChatBubble: React.FC<{ role: 'user' | 'model'; text: string; }> = ({ role, text }) => {
  const isUser = role === 'user';
  return (
    <div className={`flex w-full mb-4 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-slate-200' : 'bg-indigo-600'}`}>
          {isUser ? <User className="w-5 h-5 text-slate-600" /> : <Bot className="w-5 h-5 text-white" />}
        </div>
        <div className={`p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${
          isUser 
            ? 'bg-slate-100 text-slate-800 rounded-tr-none' 
            : 'bg-white border border-slate-100 text-slate-700 rounded-tl-none'
        }`}>
          <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2">
             <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
};

export const ChatInput: React.FC<{ 
  onSend: (msg: string) => void; 
  disabled?: boolean;
  placeholder?: string;
}> = ({ onSend, disabled, placeholder }) => {
  const [input, setInput] = React.useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput('');
  };

  return (
    <div className="border-t border-slate-200 pt-4 mt-2">
      <div className="relative flex items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={placeholder || "Type your message..."}
          disabled={disabled}
          className="w-full pl-4 pr-12 py-3 bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || disabled}
          className="absolute right-2 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:bg-slate-400 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// --- RESUME PREVIEW COMPONENT ---

export const ResumePreview: React.FC<{ 
  resume: ParsedResume; 
  onDownloadTex: () => void; 
  onDownloadJson: () => void;
  onDownloadMd: () => void;
}> = ({ 
  resume, 
  onDownloadTex,
  onDownloadJson,
  onDownloadMd
}) => {
  const [viewMode, setViewMode] = useState<'visual' | 'markdown'>('visual');
  const markdownSource = generateMarkdown(resume);

  return (
    <div className="flex flex-col h-full bg-slate-100 rounded-xl overflow-hidden border border-slate-200">
      <div className="bg-white border-b border-slate-200 p-3 flex justify-between items-center shadow-sm z-10 flex-wrap gap-2">
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-semibold text-slate-700 hidden sm:inline">Resume Tailored</span>
           </div>
           
           {/* View Toggle */}
           <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
             <button 
               onClick={() => setViewMode('visual')}
               className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${viewMode === 'visual' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <Eye className="w-3 h-3" /> Visual
             </button>
             <button 
               onClick={() => setViewMode('markdown')}
               className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all ${viewMode === 'markdown' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
             >
               <Code className="w-3 h-3" /> Markdown Source
             </button>
           </div>
        </div>
        
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDownloadJson} className="text-xs h-8 px-2" title="Download JSON">
             <FileJson className="w-3 h-3 sm:mr-2" />
             <span className="hidden sm:inline">JSON</span>
          </Button>
          <Button variant="outline" onClick={onDownloadMd} className="text-xs h-8 px-2" title="Download Markdown">
             <FileText className="w-3 h-3 sm:mr-2" />
             <span className="hidden sm:inline">MD</span>
          </Button>
          <Button variant="primary" onClick={onDownloadTex} className="text-xs h-8 px-2" title="Download LaTeX">
             <Download className="w-3 h-3 sm:mr-2" />
             <span className="hidden sm:inline">TeX</span>
          </Button>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-200/50">
         
         {viewMode === 'markdown' ? (
           <div className="p-6">
             <div className="bg-slate-900 rounded-lg shadow-lg border border-slate-700 overflow-hidden">
               <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center gap-2">
                 <div className="flex gap-1.5">
                   <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
                   <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
                   <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
                 </div>
                 <span className="ml-2 text-xs text-slate-400 font-mono">resume.md</span>
               </div>
               <pre className="p-4 text-xs sm:text-sm font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
                 {markdownSource}
               </pre>
             </div>
           </div>
         ) : (
           /* Visual representation mocking a paper resume */
           <div className="p-4 sm:p-8 flex justify-center">
             <div className="max-w-[210mm] w-full bg-white shadow-xl p-[6mm] sm:p-[10mm] min-h-[297mm] text-slate-900 border border-slate-300">
                {/* Header */}
                <div className="text-center border-b border-slate-300 pb-4 mb-4">
                  <h1 className="text-2xl font-bold uppercase tracking-wide">{resume.contact_info.full_name}</h1>
                  <div className="text-xs text-slate-600 mt-2 flex justify-center gap-3 flex-wrap">
                     <span>{resume.contact_info.email}</span>
                     <span>|</span>
                     <span>{resume.contact_info.location}</span>
                     {resume.contact_info.linkedin_url && (
                        <><span>|</span><span>LinkedIn</span></>
                     )}
                  </div>
                </div>

                {/* Summary */}
                <div className="mb-4">
                   <h2 className="text-sm font-bold uppercase border-b border-slate-300 mb-2">Professional Summary</h2>
                   <div className="text-xs leading-relaxed text-slate-800">
                     <ReactMarkdown>{resume.professional_summary}</ReactMarkdown>
                   </div>
                </div>

                {/* Experience */}
                <div className="mb-4">
                  <h2 className="text-sm font-bold uppercase border-b border-slate-300 mb-2">Experience</h2>
                  <div className="space-y-3">
                    {resume.work_experience.map((job, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-xs font-bold">
                           <span>{job.role_title}</span>
                           <span>{job.dates_employed}</span>
                        </div>
                        <div className="flex justify-between text-xs text-slate-600 italic mb-1">
                           <span>{job.company_name}</span>
                           <span>{job.location}</span>
                        </div>
                        <ul className="list-disc list-outside ml-4 text-xs space-y-0.5 text-slate-800">
                           {job.bullet_points.map((b, j) => (
                             <li key={j} className="pl-1">
                               <ReactMarkdown components={{p: ({children}) => <>{children}</>}}>{b.raw_text}</ReactMarkdown>
                             </li>
                           ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>

                 {/* Projects */}
                 {resume.projects.length > 0 && (
                    <div className="mb-4">
                      <h2 className="text-sm font-bold uppercase border-b border-slate-300 mb-2">Projects</h2>
                      <div className="space-y-3">
                        {resume.projects.map((proj, i) => (
                          <div key={i}>
                            <div className="flex justify-between text-xs font-bold">
                              <span>{proj.project_name}</span>
                              <span className="italic font-normal">{proj.technologies_used.join(", ")}</span>
                            </div>
                            <ul className="list-disc list-outside ml-4 text-xs space-y-0.5 text-slate-800">
                              {proj.bullet_points.map((b, j) => (
                                <li key={j} className="pl-1">
                                  <ReactMarkdown components={{p: ({children}) => <>{children}</>}}>{b.raw_text}</ReactMarkdown>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                 )}

                {/* Skills */}
                <div className="mb-4">
                   <h2 className="text-sm font-bold uppercase border-b border-slate-300 mb-2">Skills</h2>
                   <div className="text-xs">
                      {resume.skills.map((grp, i) => (
                         <div key={i} className="mb-1">
                            <span className="font-bold">{grp.category_name}: </span>
                            <span>{grp.items.join(", ")}</span>
                         </div>
                      ))}
                   </div>
                </div>

             </div>
           </div>
         )}
      </div>
    </div>
  );
};
