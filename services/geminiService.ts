import { GoogleGenAI, Type, Chat } from "@google/genai";
import { ParsedResume, CopilotAction, CorpusChunk, EnrichedCorpusItem } from "../types";

// Initialize Gemini Client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export type TokenUsageHandler = (tokens: number) => void;

// Helper to extract and report usage
const reportUsage = (response: any, handler?: TokenUsageHandler) => {
  if (response?.usageMetadata?.totalTokenCount && handler) {
    handler(response.usageMetadata.totalTokenCount);
  }
};

// --- UTILS: Client-Side Vector Math ---

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- SCHEMA DEFINITION (Parsing) ---
const resumeSchema = {
  type: Type.OBJECT,
  properties: {
    contact_info: {
      type: Type.OBJECT,
      properties: {
        full_name: { type: Type.STRING },
        email: { type: Type.STRING },
        phone: { type: Type.STRING },
        linkedin_url: { type: Type.STRING },
        github_url: { type: Type.STRING },
        website_url: { type: Type.STRING },
        location: { type: Type.STRING },
      },
    },
    professional_summary: {
      type: Type.STRING,
      description: "The existing summary from the PDF, OR a generated summary if none exists.",
    },
    work_experience: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          company_name: { type: Type.STRING },
          role_title: { type: Type.STRING },
          dates_employed: { type: Type.STRING },
          location: { type: Type.STRING },
          bullet_points: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { raw_text: { type: Type.STRING } },
            },
          },
        },
      },
    },
    projects: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          project_name: { type: Type.STRING },
          role_title: { type: Type.STRING },
          technologies_used: { type: Type.ARRAY, items: { type: Type.STRING } },
          bullet_points: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { raw_text: { type: Type.STRING } },
            },
          },
        },
      },
    },
    education: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          institution_name: { type: Type.STRING },
          degree_obtained: { type: Type.STRING },
          graduation_date: { type: Type.STRING },
          achievements: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
    skills: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category_name: { type: Type.STRING },
          items: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
      },
    },
    certifications: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: [
    "contact_info",
    "professional_summary",
    "work_experience",
    "projects",
    "education",
    "skills",
    "certifications",
  ],
};

const RESUME_PARSER_PROMPT = `
You are a highly precise Resume Parsing Agent.

TASK:
Convert the attached PDF resume into the structured JSON format provided in the schema.

---

CRITICAL INSTRUCTIONS FOR MISSING DATA:
1.  **NO NULLS:** You must NEVER output null or None. 
    * If a text field (like email or location) is missing, you MUST return an empty string: "".
    * If a list field (like projects or certifications) is missing, you MUST return an empty list: [].
2.  **ALL KEYS REQUIRED:** The output JSON must contain every top-level key defined in the schema (contact_info, work_experience, etc.), even if the content inside is empty.

---

LOGIC FOR "PROFESSIONAL SUMMARY":
Step 1: Look for a section titled "Summary", "Profile", "About Me", or similar in the PDF.
Step 2: 
    * **IF FOUND:** Extract the text verbatim into the professional_summary field.
    * **IF NOT FOUND:** You must ACT as a professional resume writer. Read the Candidate's work_experience and skills. Generate a high-quality, 3-sentence professional summary describing their seniority, main role, and key strengths. Place this generated text into the professional_summary field.

---

LOGIC FOR "WORK EXPERIENCE":
* Extract text exactly as written.
* Treat every bullet point as a separate item.
* If a job has a paragraph description but no bullets, split the sentences into separate items in the bullet_points array.

---

LOGIC FOR "SKILLS":
* Group skills into categories based on the resume layout (e.g., "Languages", "Tech Stack"). 
* If no categories are visual, create logical categories based on the content (e.g., put Python under "Programming", Agile under "Methodologies").
`;

// --- MAIN FUNCTIONS ---

export const parseResumeWithGemini = async (
  base64Data: string,
  mimeType: string,
  onTokenUsage?: TokenUsageHandler
): Promise<ParsedResume> => {
  try {
    const modelId = "gemini-3-pro-preview";
    
    // Better handling for text-based formats (including extracted text from browser)
    const isTextBased = mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType.includes('tex');
    
    let parts: any[] = [];
    
    if (isTextBased) {
        try {
            const binaryString = atob(base64Data);
            const bytes = Uint8Array.from(binaryString, c => c.charCodeAt(0));
            const textContent = new TextDecoder().decode(bytes);
            parts.push({ 
                text: `[RESUME CONTENT START]\n${textContent}\n[RESUME CONTENT END]` 
            });
        } catch (e) {
            console.warn("Failed to decode text resume, falling back to inlineData", e);
            parts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
        }
    } else {
        parts.push({ inlineData: { mimeType: mimeType, data: base64Data } });
    }

    parts.push({ text: RESUME_PARSER_PROMPT });

    const response = await ai.models.generateContent({
      model: modelId,
      contents: { parts },
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: resumeSchema,
      },
    });

    reportUsage(response, onTokenUsage);

    const text = response.text;
    if (!text) throw new Error("No response from Gemini");
    return JSON.parse(text) as ParsedResume;
  } catch (error) {
    console.error("Error parsing resume:", error);
    throw error;
  }
};

export const generateRichCorpus = (resumeJson: ParsedResume): CorpusChunk[] => {
  const corpusChunks: CorpusChunk[] = [];

  if (resumeJson.work_experience) {
    for (const job of resumeJson.work_experience) {
      const contextHeader = `ROLE: ${job.role_title} | COMPANY: ${job.company_name} | LOCATION: ${job.location} | DATES: ${job.dates_employed}`;
      for (const bullet of job.bullet_points) {
        const richText = `${contextHeader}\nACHIEVEMENT: ${bullet.raw_text}`;
        const meta = {
          type: "work_experience",
          company: job.company_name,
          role: job.role_title,
          id: `${job.company_name}_${job.role_title}`,
        };
        corpusChunks.push({ text: richText, metadata: meta });
      }
    }
  }

  if (resumeJson.projects) {
    for (const proj of resumeJson.projects) {
      const techStack = proj.technologies_used.join(", ");
      const contextHeader = `PROJECT: ${proj.project_name} | ROLE: ${proj.role_title} | TECH STACK: ${techStack}`;
      for (const bullet of proj.bullet_points) {
        const richText = `${contextHeader}\nDETAIL: ${bullet.raw_text}`;
        const meta = { type: "project", technologies: proj.technologies_used };
        corpusChunks.push({ text: richText, metadata: meta });
      }
    }
  }

  if (resumeJson.education) {
    for (const edu of resumeJson.education) {
      const contextHeader = `category: EDUCATION | degree: ${edu.degree_obtained} | institution: ${edu.institution_name} | year: ${edu.graduation_date}`;
      corpusChunks.push({
        text: `${contextHeader}\nSUMMARY: Graduated with ${edu.degree_obtained}.`,
        metadata: { type: "education", subtype: "degree" },
      });
      for (const achievement of edu.achievements) {
        corpusChunks.push({
          text: `${contextHeader}\nACHIEVEMENT: ${achievement}`,
          metadata: { type: "education", subtype: "achievement" },
        });
      }
    }
  }

  if (resumeJson.skills) {
    for (const skillGroup of resumeJson.skills) {
      const category = skillGroup.category_name || "General";
      const skillsList = skillGroup.items.join(", ");
      corpusChunks.push({
        text: `category: SKILLS | group: ${category}\nLIST: ${skillsList}`,
        metadata: { type: "skill_group", category: category },
      });
    }
  }

  if (resumeJson.certifications) {
    for (const cert of resumeJson.certifications) {
      corpusChunks.push({
        text: `category: CERTIFICATION\nTITLE: ${cert}`,
        metadata: { type: "certification" },
      });
    }
  }

  if (resumeJson.professional_summary) {
    corpusChunks.push({
      text: `category: PROFESSIONAL SUMMARY\nTEXT: ${resumeJson.professional_summary}`,
      metadata: { type: "summary" },
    });
  }

  return corpusChunks;
};

// --- RAG: ENRICHMENT & EMBEDDING ---

const enrichmentSchema = {
  type: Type.OBJECT,
  properties: {
    fused_sentence: { type: Type.STRING, description: "The natural first-person sentence merging context and achievement." },
    keywords: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Explicit high-value technical keywords." },
    skills_implied: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Soft skills or methodologies inferred." },
    category: { type: Type.STRING, description: "The classification of this item." },
  },
  required: ["fused_sentence", "keywords", "skills_implied", "category"],
};

async function enrichItem(item: CorpusChunk, onTokenUsage?: TokenUsageHandler): Promise<EnrichedCorpusItem | null> {
  const modelId = "gemini-3-pro-preview";
  const prompt = `
    You are a Resume Data Engineer. Optimize this resume data for Vector Retrieval.
    
    INPUT DATA:
    "${item.text}"

    TASK:
    1. **Fusion (Crucial):** Rewrite the input into a single, natural, first-person sentence. 
       - You MUST naturally incorporate the ROLE, COMPANY, DEGREE, or SCHOOL from the header.
       - Example Input: "ROLE: Dev | COMPANY: Google | Bullet: Fixed bugs"
       - Example Output: "As a Developer at Google, I fixed critical bugs."
    2. **Keywords:** Extract explicit high-value keywords (tech stack, tools).
    3. **Implied Skills:** Infer soft skills (e.g., "mentored" -> "Leadership").
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: enrichmentSchema,
        temperature: 0.1,
      },
    });

    reportUsage(response, onTokenUsage);

    if (!response.text) return null;
    const data = JSON.parse(response.text);

    return {
      id: Math.random().toString(36).substring(7),
      content: data.fused_sentence,
      keywords: data.keywords || [],
      skills_implied: data.skills_implied || [],
      category: data.category,
      raw_source: item.text,
      metadata: item.metadata,
    };
  } catch (e) {
    console.error("Error enriching item", e);
    // Fallback if enrichment fails
    return {
      id: Math.random().toString(36).substring(7),
      content: item.text,
      keywords: [],
      skills_implied: [],
      category: "unknown",
      raw_source: item.text,
      metadata: item.metadata,
    };
  }
}

export const enrichAndEmbedCorpus = async (
    corpus: CorpusChunk[], 
    onProgress?: (count: number, total: number) => void,
    onTokenUsage?: TokenUsageHandler
): Promise<EnrichedCorpusItem[]> => {
  const enrichedItems: EnrichedCorpusItem[] = [];
  
  // 1. Enrichment Phase
  const BATCH_SIZE = 5; 
  for (let i = 0; i < corpus.length; i += BATCH_SIZE) {
    const batch = corpus.slice(i, i + BATCH_SIZE);
    const promises = batch.map(item => enrichItem(item, onTokenUsage));
    const results = await Promise.all(promises);
    
    results.forEach(res => {
      if (res) enrichedItems.push(res);
    });
    
    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, corpus.length), corpus.length * 2);
  }

  // 2. Embedding Phase
  const textsToEmbed = enrichedItems.map(item => item.content);
  const EMBED_BATCH_SIZE = 20;
  for (let i = 0; i < textsToEmbed.length; i += EMBED_BATCH_SIZE) {
    const batchTexts = textsToEmbed.slice(i, i + EMBED_BATCH_SIZE);
    try {
      // Note: embedContent technically uses tokens, but the client library 
      // response format for embedding usage varies. 
      // We will skip explicit tracking for embedding calls for simplicity 
      // or assume a flat rate if needed, but for now we focus on GenAI calls.
      const response = await ai.models.embedContent({
        model: "text-embedding-004",
        contents: batchTexts,
      });

      if (response.embeddings) {
        response.embeddings.forEach((emb, idx) => {
          if (emb.values) {
            enrichedItems[i + idx].embedding = emb.values;
          }
        });
      }
    } catch (e) {
      console.error("Embedding error:", e);
    }
    if (onProgress) onProgress(corpus.length + Math.min(i + EMBED_BATCH_SIZE, textsToEmbed.length), corpus.length * 2);
  }

  return enrichedItems.filter(item => item.embedding !== undefined);
};

// --- ADVANCED RAG LOGIC ---

async function extractRequirementsFromJD(
    jdText: string, 
    requirementCount: number = 5,
    onTokenUsage?: TokenUsageHandler
): Promise<string[]> {
  const modelId = "gemini-2.5-flash"; 
  const prompt = `
    Analyze the job description below, extract top ${requirementCount} most critical hard skills, technologies, or competencies required.
    
    Only keep competencies, tools, or outcomes that are specific to this role.
    Ignore generic expectations.

    Job Description:
    ${jdText}

    Rules:
    - Each requirement must be one concise sentence.
    - Capture only the core differentiators (domain expertise, tech stack, regulatory knowledge, target metrics).
    - Do NOT include soft skills unless unusual.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        temperature: 0.2,
      },
    });

    reportUsage(response, onTokenUsage);
    
    if (!response.text) return [];
    return JSON.parse(response.text) as string[];
  } catch (e) {
    console.warn("Error extracting requirements, falling back to full JD", e);
    return []; 
  }
}

export const getRagContext = async (
  jdText: string,
  vectorStore: EnrichedCorpusItem[],
  options: {
    includeSummary?: boolean;
    includeEducation?: boolean;
    requirementCount?: number;
    reqMatchCount?: number;
    finalContextLimit?: number;
  } = {},
  onTokenUsage?: TokenUsageHandler
): Promise<string> => {
  const {
    includeSummary = true,
    includeEducation = true,
    requirementCount = 6,
    reqMatchCount = 6,
    finalContextLimit = 15,
  } = options;

  // 1. Identify Fixed Context (Summary, Education)
  const finalIds = new Set<string>();
  const docsById = new Map<string, EnrichedCorpusItem>();
  vectorStore.forEach(d => docsById.set(d.id, d));

  if (includeSummary) {
    vectorStore
      .filter(d => d.metadata?.type === 'summary')
      .forEach(d => finalIds.add(d.id));
  }
  if (includeEducation) {
    vectorStore
      .filter(d => d.metadata?.type === 'education')
      .forEach(d => finalIds.add(d.id));
  }

  // 2. Extract Requirements from JD
  let requirements = await extractRequirementsFromJD(jdText, requirementCount, onTokenUsage);
  
  if (requirements.length === 0) {
    requirements = [jdText.substring(0, 1000)]; 
  }

  // 3. Search per requirement and Aggregate Scores
  const chunkScores = new Map<string, number>();

  let reqEmbeddings: number[][] = [];
  try {
    const resp = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: requirements,
    });
    if (resp.embeddings) {
      reqEmbeddings = resp.embeddings.map(e => e.values || []);
    }
  } catch (e) {
    console.error("Embedding requirements failed", e);
  }

  reqEmbeddings.forEach((reqVec) => {
    const scores = vectorStore.map(item => ({
      id: item.id,
      score: item.embedding ? cosineSimilarity(reqVec, item.embedding) : -1
    }));
    
    scores.sort((a, b) => b.score - a.score);
    
    const hits = scores.slice(0, reqMatchCount);
    
    hits.forEach(hit => {
      const current = chunkScores.get(hit.id) || 0;
      chunkScores.set(hit.id, current + hit.score);
    });
  });

  const sortedIds = Array.from(chunkScores.entries())
    .sort((a, b) => b[1] - a[1]) // Descending score
    .map(entry => entry[0]);

  const initialFixedCount = finalIds.size;
  for (const uid of sortedIds) {
    if (finalIds.size >= finalContextLimit + initialFixedCount) break;
    finalIds.add(uid);
  }

  const contextBlocks: string[] = [];
  
  vectorStore.forEach(doc => {
      if (finalIds.has(doc.id)) {
        const category = (doc.category || 'General').toUpperCase();
        const keywords = doc.keywords || [];
        const skills = doc.skills_implied || [];
        const metaTags = [...keywords, ...skills].slice(0, 8).join(", ");

        const block = `[${category}] ${doc.content}\n(Tags: ${metaTags})`;
        contextBlocks.push(block);
      }
  });

  return contextBlocks.join("\n\n");
};

// --- JOB APP COPILOT (Chatbot Class) ---

export class JobAppCopilot {
  private chatSession: Chat | null = null;
  private jdText: string;
  private evidence: string;
  private requirements: string;
  private modelName: string = "gemini-3-pro-preview";
  private onTokenUsage?: TokenUsageHandler;

  constructor(jdText: string, evidence: string, requirements: string[], onTokenUsage?: TokenUsageHandler) {
    this.jdText = jdText;
    this.evidence = evidence;
    this.requirements = requirements.map(r => `- ${r}`).join("\n");
    this.onTokenUsage = onTokenUsage;
  }

  private startNewSession(systemInstruction: string, temperature: number = 0.7) {
    this.chatSession = ai.chats.create({
      model: this.modelName,
      config: {
        temperature: temperature,
        systemInstruction: systemInstruction,
      },
      history: [
        { role: "user", parts: [{ text: "I am ready to start." }] },
        { role: "model", parts: [{ text: "Understood. I have reviewed your resume context and the job description." }] },
      ],
    });
  }

  public async draftCoverLetter(tone: string = "professional and confident"): Promise<string> {
    const systemInstruction = `
        You are an expert Career Strategist and Copywriter acting on behalf of the user.
        Your goal is to draft a high-impact, evidence-based cover letter that bridges the user's past achievements to the company's future needs.  
        
        ### INPUT DATA
        [JOB DESCRIPTION]
        ${this.jdText}
        
        [CORE REQUIREMENTS]
        ${this.requirements}
        
        [EVIDENCE BANK]
        ${this.evidence}
        
        ### STRATEGY
        1. **The Hook:** Start with a strong professional value statement. Do NOT use "I am writing to apply..."
        2. **The Body (The Bridge):** - Identify the top matching skills from the Job Description.
           - Find the Evidence blocks where (Tags: ...) match these skills.
           - Weave those specific [WORK EXPERIENCE] or [PROJECT] stories into the narrative.
        3. **The Close:** Confident call to action.
        
        ### RULES:
        - Write 3–4 cohesive paragraphs (Intro, Body, Closing). Strict 200-250 words.
        - Tone: ${tone}. Confident but grounded. Avoid embellishment or speculation. Grounded strictly in the evidence.
        - NO bullet points or citations.
        - Under ~250 words.
        - Focus heavily on evidence-backed accomplishments. 
        - Anti-Hallucination: Never invent facts beyond evidence.
        - Never invent facts. If a skill is missing in the Evidence, acknowledge the gap or focus on transferable skills found in the (Tags: ...) section.
        - Derive all facts from the evidence and rephrase them naturally: NEVER copy text or mention IDs. Never repeat JD text verbatim.
    `;

    this.startNewSession(systemInstruction, 0.7);
    if (!this.chatSession) throw new Error("Chat session failed to initialize");

    const result = await this.chatSession.sendMessage({ message: "Draft the cover letter now based on the provided instructions." });
    reportUsage(result, this.onTokenUsage);
    return result.text;
  }

  public async startQuestionMode(tone: string = "professional and confident"): Promise<string> {
    const systemInstruction = `
        You are an expert Career Strategist acting on behalf of the user.
        Your goal is to draft high-impact, evidence-based answers to job application questions.        
        
        ### INPUT DATA
        [JOB DESCRIPTION]
        ${this.jdText}
        
        [CORE REQUIREMENTS (The Target)]
        ${this.requirements}
        
        [EVIDENCE BANK (The Source Material)]
        ${this.evidence}

        ### EXECUTION PROTOCOL
        1. **Scan Tags:** Look at the (Tags: ...) in the Evidence blocks. Match these tags to the core requirements of the question.
        2. **Select Context:** identify which piece of User Evidence best proves the competence required by the question. 
        Prioritize evidence marked [WORK EXPERIENCE] or [PROJECTS] over [EDUCATION] unless the question asks for academic background.
        3. **Structure (STAR Method):** For behavioral questions ("Tell me about a time..."), strictly follow:
            - **S/T (Situation):** "In my role as [Role] at [Company]..." (Derive this from the Evidence header).
            - **A (Action):** What did you do? (Use the main sentence from the Evidence).
            - **R (Result):** What was the outcome?
        
        GENERAL RULES:
        - Always <= 100 words, <= 5 sentences (unless told otherwise).
        - Always keep tone ${tone}.
        - Never repeat JD text verbatim.
        - Never invent facts beyond evidence.
    `;
    
    this.startNewSession(systemInstruction, 0.2);
    return "Ready. What question would you like me to answer?";
  }

  public async sendMessage(message: string): Promise<string> {
    if (!this.chatSession) {
      return "Session not started. Please initialize a task first.";
    }
    const result = await this.chatSession.sendMessage({ message });
    reportUsage(result, this.onTokenUsage);
    return result.text;
  }
}

// --- RESUME TAILORING & LATEX GENERATION ---

/**
 * Tailors the resume JSON to the JD using Gemini.
 */
export const tailorResume = async (
  originalResume: ParsedResume,
  jdText: string,
  requirements: string[] = [],
  onTokenUsage?: TokenUsageHandler
): Promise<ParsedResume> => {
  const modelId = "gemini-3-pro-preview";
  
  const prompt = `
    You are an expert Resume Strategist and Editor.
    
    ### OBJECTIVE
    Take the User's [MASTER RESUME] and tailor it specifically for the [JOB DESCRIPTION].
    Your goal is to maximize the match level by selecting the most relevant experiences and using the JD's keywords to rewrite bullet points.

    ### INPUT DATA
    [JOB DESCRIPTION]
    ${jdText.substring(0, 10000)}

    [CORE REQUIREMENTS]
    ${requirements.join(", ")}

    [MASTER RESUME DATA]
    ${JSON.stringify(originalResume)}
    
    ### EDITING RULES
    1. **Protected Fields:** NEVER CHANGE 'contact_info' or 'education'. Only edit 'work_experience', 'projects', 'skills', and 'professional_summary'.

    2. **Selection:**
        - **Experience:** Keep the most recent 1 role. For older roles, select 1 that matches JD the most.
        - **Projects:** Select exactly the top 3 projects that best demonstrate the *skills required in the JD* and core requirements. Drop irrelevant projects.
    
    3. **Rewriting (The Core Task):**
        - Rewrite bullet points to mirror the language of the JD.
        - **Impact First:** Use "Action -> Result" structure (e.g., "Reduced latency by 40% using Python").
        - **Keywords:** If the JD asks for "Optimization," ensure the resume says "Optimized," not "Improved."
        - **Bolding:** You MUST strictly wrap high-impact keywords in Markdown bolding (e.g., **Python**, **Increased revenue**). This is critical for the output.
    
    4. **Skills Section:**
        - Reorder skills so the ones mentioned in the JD appear first.

    5. **Professional Summary (CRITICAL):**
        - **Action:** You MUST generate a new, targeted summary (3 sentences max).
        - **Even if a summary exists, REWRITE IT to target this specific JD.**
        - **Use bolding for keywords** inside the summary too.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: resumeSchema,
        temperature: 0,
      }
    });

    reportUsage(response, onTokenUsage);

    if (!response.text) throw new Error("No response");
    return JSON.parse(response.text) as ParsedResume;
  } catch (e) {
    console.error("Resume tailoring failed:", e);
    throw e;
  }
};

export const generateMarkdown = (resume: ParsedResume): string => {
  let md = `# ${resume.contact_info.full_name}\n\n`;
  
  // Contact
  const contact = [];
  if (resume.contact_info.email) contact.push(`Email: ${resume.contact_info.email}`);
  if (resume.contact_info.phone) contact.push(`Phone: ${resume.contact_info.phone}`);
  if (resume.contact_info.location) contact.push(`Location: ${resume.contact_info.location}`);
  if (resume.contact_info.linkedin_url) contact.push(`[LinkedIn](${resume.contact_info.linkedin_url})`);
  if (resume.contact_info.github_url) contact.push(`[GitHub](${resume.contact_info.github_url})`);
  if (resume.contact_info.website_url) contact.push(`[Portfolio](${resume.contact_info.website_url})`);
  
  md += contact.join(' | ') + '\n\n';
  
  // Summary
  if (resume.professional_summary) {
    md += `## Professional Summary\n\n${resume.professional_summary}\n\n`;
  }
  
  // Experience
  if (resume.work_experience && resume.work_experience.length > 0) {
    md += `## Work Experience\n\n`;
    resume.work_experience.forEach(job => {
      md += `### ${job.role_title}\n`;
      md += `**${job.company_name}** | ${job.location} | ${job.dates_employed}\n\n`;
      job.bullet_points.forEach(bp => {
        md += `- ${bp.raw_text}\n`;
      });
      md += '\n';
    });
  }

  // Projects
  if (resume.projects && resume.projects.length > 0) {
    md += `## Projects\n\n`;
    resume.projects.forEach(proj => {
      md += `### ${proj.project_name}\n`;
      md += `**${proj.role_title}** | Tech Stack: ${proj.technologies_used.join(', ')}\n\n`;
      proj.bullet_points.forEach(bp => {
        md += `- ${bp.raw_text}\n`;
      });
      md += '\n';
    });
  }
  
  // Education
  if (resume.education && resume.education.length > 0) {
    md += `## Education\n\n`;
    resume.education.forEach(edu => {
      md += `### ${edu.institution_name}\n`;
      md += `${edu.degree_obtained} | ${edu.graduation_date}\n\n`;
      if (edu.achievements && edu.achievements.length > 0) {
        edu.achievements.forEach(ach => {
          md += `- ${ach}\n`;
        });
        md += '\n';
      }
    });
  }
  
  // Skills
  if (resume.skills && resume.skills.length > 0) {
    md += `## Skills\n\n`;
    resume.skills.forEach(skillGroup => {
      md += `**${skillGroup.category_name}:** ${skillGroup.items.join(', ')}\n\n`;
    });
  }

  // Certifications
  if (resume.certifications && resume.certifications.length > 0) {
    md += `## Certifications\n\n`;
    resume.certifications.forEach(cert => {
      md += `- ${cert}\n`;
    });
    md += '\n';
  }

  return md;
};

export const generateLatex = (resume: ParsedResume): string => {
  const escapeLatex = (text: string) => {
    if (!text) return "";
    return text
      .replace(/&/g, "\\&")
      .replace(/%/g, "\\%")
      .replace(/\$/g, "\\$")
      .replace(/#/g, "\\#")
      .replace(/_/g, "\\_")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/~/g, "\\textasciitilde{}")
      .replace(/\^/g, "\\textasciicircum{}");
  };

  const formatText = (text: string) => {
      if (!text) return "";
      const parts = text.split("**");
      return parts.map((part, index) => {
          const escaped = escapeLatex(part);
          if (index % 2 === 1) { 
              return `\\textbf{${escaped}}`;
          }
          return escaped;
      }).join("");
  };

  let tex = `\\documentclass[10pt, letterpaper]{article}

\\usepackage[utf8]{inputenc}
\\usepackage{geometry}
\\usepackage{enumitem}
\\usepackage{hyperref}
\\usepackage{titlesec}
\\usepackage{xcolor}

\\geometry{left=0.75in, top=0.6in, right=0.75in, bottom=0.6in}
\\pagestyle{empty} 
\\setlength{\\parindent}{0pt}

\\hypersetup{
    colorlinks=true,
    linkcolor=blue,
    filecolor=magenta,      
    urlcolor=blue,
}

\\titleformat{\\section}{\\large\\bfseries\\uppercase}{}{0em}{}[\\titlerule]
\\titlespacing{\\section}{0pt}{12pt}{6pt}

\\begin{document}

\\begin{center}
    {\\huge \\bfseries ${escapeLatex(resume.contact_info.full_name)}} \\\\[4pt]
    ${escapeLatex(resume.contact_info.location)} \\ \\textbullet \\ ${escapeLatex(resume.contact_info.phone)} \\ \\textbullet \\ \\href{mailto:${resume.contact_info.email}}{${escapeLatex(resume.contact_info.email)}}
    
    ${resume.contact_info.linkedin_url ? `\\ \\textbullet \\ \\href{${resume.contact_info.linkedin_url}}{LinkedIn}` : ''}
    ${resume.contact_info.github_url ? `\\ \\textbullet \\ \\href{${resume.contact_info.github_url}}{GitHub}` : ''}
    ${resume.contact_info.website_url ? `\\ \\textbullet \\ \\href{${resume.contact_info.website_url}}{Portfolio}` : ''}
\\end{center}

${resume.professional_summary ? `
\\section{Professional Summary}
${formatText(resume.professional_summary)}
` : ''}

\\section{Experience}
${resume.work_experience.map(job => `
\\noindent
\\textbf{${escapeLatex(job.role_title)}} \\hfill ${escapeLatex(job.dates_employed)} \\\\
\\textit{${escapeLatex(job.company_name)}} \\hfill ${escapeLatex(job.location)}
\\begin{itemize}[noitemsep, topsep=2pt, leftmargin=15pt]
${job.bullet_points.map(bp => `    \\item ${formatText(bp.raw_text)}`).join('\n')}
\\end{itemize}
\\vspace{6pt}
`).join('\n')}

${resume.projects.length > 0 ? `
\\section{Projects}
${resume.projects.map(proj => `
\\noindent
\\textbf{${escapeLatex(proj.project_name)}} $|$ \\textit{${escapeLatex(proj.role_title)}} \\hfill ${formatText(proj.technologies_used.join(', '))}
\\begin{itemize}[noitemsep, topsep=2pt, leftmargin=15pt]
${proj.bullet_points.map(bp => `    \\item ${formatText(bp.raw_text)}`).join('\n')}
\\end{itemize}
\\vspace{6pt}
`).join('\n')}
` : ''}

${resume.skills.length > 0 ? `
\\section{Technical Skills}
\\begin{itemize}[noitemsep, topsep=2pt, leftmargin=15pt]
${resume.skills.map(group => `
    \\item \\textbf{${escapeLatex(group.category_name)}:} ${escapeLatex(group.items.join(', '))}
`).join('\n')}
\\end{itemize}
` : ''}

${resume.education.length > 0 ? `
\\section{Education}
${resume.education.map(edu => `
\\noindent
\\textbf{${escapeLatex(edu.institution_name)}} \\hfill ${escapeLatex(edu.graduation_date)} \\\\
${escapeLatex(edu.degree_obtained)}
${edu.achievements.length > 0 ? `
\\begin{itemize}[noitemsep, topsep=2pt, leftmargin=15pt]
${edu.achievements.map(ach => `    \\item ${formatText(ach)}`).join('\n')}
\\end{itemize}
` : '\\vspace{4pt}'}
`).join('\n')}
` : ''}

${resume.certifications.length > 0 ? `
\\section{Certifications}
\\begin{itemize}[noitemsep, topsep=2pt, leftmargin=15pt]
${resume.certifications.map(cert => `    \\item ${formatText(cert)}`).join('\n')}
\\end{itemize}
` : ''}

\\end{document}
  `;

  return tex;
};
