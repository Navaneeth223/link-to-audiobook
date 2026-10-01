declare module '*.css';
declare module '*?url' { const url: string; export default url; }
declare module '*?raw' { const content: string; export default content; }
interface ImportMetaEnv { readonly VITE_DONATION_LINKS?: string; readonly VITE_API_BASE_URL?: string; }
interface ImportMeta { readonly env: ImportMetaEnv; }
