# JobAlign Copilot Architecture

This document illustrates the data flow and agentic structure of the application.

## High-Level Data Flow

```mermaid
graph TD
    subgraph Client [Client Side App]
        User[User]
        UI[React UI]
        
        subgraph Data [State Management]
            ParsedJSON[Parsed Resume JSON]
            VectorDB[(Vector Store\nEnriched Chunks)]
            JD[Job Description]
        end
        
        subgraph Services [Gemini Service]
            Parser[Resume Parser Agent]
            Indexer[RAG Indexer]
            Retriever[Context Retriever]
            Generator[Content Generator Agent]
            LatexGen[LaTeX Generator]
        end
    end
    
    subgraph GoogleAI [Google Gemini API]
        GeminiPro[Gemini 1.5 Pro\n(Reasoning & Generation)]
        Embedding[Text Embedding 004\n(Vectorization)]
    end

    %% 1. Parsing Flow
    User -->|1. Uploads PDF/TXT| UI
    UI -->|File Data| Parser
    Parser -->|Prompt + File| GeminiPro
    GeminiPro -->|Structured JSON| Parser
    Parser -->|Set State| ParsedJSON
    
    %% 2. Indexing Flow (Background)
    ParsedJSON -->|Generate Corpus| Indexer
    Indexer -->|Enrich Chunks (Fusion)| GeminiPro
    GeminiPro -->|Enriched Text| Indexer
    Indexer -->|Embed Text| Embedding
    Embedding -->|Vectors| Indexer
    Indexer -->|Store| VectorDB
    
    %% 3. Context Setup
    User -->|2. Enters JD| UI
    UI -->|Set State| JD
    
    User -->|3. Selects Action| UI
    
    %% 4a. Path: Tailor Resume (Direct Generation)
    UI -->|Action: Tailor Resume| Generator
    JD & ParsedJSON --> Generator
    Generator -->|Prompt: Rewrite Bullets & Keywords| GeminiPro
    GeminiPro -->|Tailored JSON| Generator
    Generator -->|JSON Data| LatexGen
    LatexGen -->|Generate .tex String| UI
    UI -->|Download| User
    
    %% 4b. Path: Chat / Cover Letter (RAG Workflow)
    UI -->|Action: Chat/Cover Letter| Retriever
    JD -->|Step A: Extract Requirements| GeminiPro
    GeminiPro -->|Key Requirements List| Retriever
    Retriever -->|Step B: Embed Query| Embedding
    Embedding -->|Query Vector| Retriever
    Retriever -->|Step C: Cosine Similarity| VectorDB
    VectorDB -->|Top K Evidence Chunks| Retriever
    Retriever -->|Context String| Generator
    
    Generator -->|Prompt + Context + JD| GeminiPro
    GeminiPro -->|Draft/Answer| Generator
    Generator -->|Stream Response| UI
```

## Component Details

### 1. Resume Parsing Agent
- **Model:** `gemini-3-pro-preview`
- **Function:** Takes raw base64 data (PDF) or text strings (MD/TXT) and enforces a strict JSON schema output (`ParsedResume`). It handles missing data by inferring summaries where necessary.

### 2. RAG Indexer (Enrichment)
- **Model:** `gemini-3-pro-preview` + `text-embedding-004`
- **Function:** 
    - Breaks the resume into logical chunks (Work Experience items, Projects).
    - **Enrichment:** Uses an LLM call to rewrite bullet points into "Fused Sentences" (first-person narratives containing context like Company Name and Role) to improve semantic retrieval.
    - **Embedding:** Converts these fused sentences into vector embeddings.

### 3. Context Retriever
- **Strategy:** Requirement-Driven Retrieval.
- **Process:** Instead of simply embedding the entire Job Description (which adds noise), the system first asks Gemini to "Extract top 5 hard skill requirements" from the JD. It then searches the Vector Store for evidence matching *those specific requirements*.

### 4. Resume Tailor Agent
- **Model:** `gemini-3-pro-preview`
- **Function:** 
    - Takes the *Original Resume JSON* and the *Job Description*.
    - Selects the most relevant projects (Top 3).
    - Rewrites bullet points to adopt the JD's keywords and "Action -> Result" format.
    - Wraps key terms in Markdown bolding (`**keyword**`) which the LaTeX generator converts to `\textbf{keyword}`.

### 5. LaTeX Generator
- **Function:** A deterministic function that maps the `ParsedResume` JSON structure into a valid `.tex` string using a specific template (Jake's Resume style), handling character escaping and formatting.
