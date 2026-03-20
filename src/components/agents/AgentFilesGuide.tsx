import { useState } from 'react';
import { X, FileText, Lightbulb, Clock, ChevronRight } from 'lucide-react';
import { FILE_GUIDES, ALL_FILE_NAMES } from './agentFileGuides';

interface AgentFilesGuideProps {
  initialFile?: string;
  onClose: () => void;
}

export function AgentFilesGuide({ initialFile, onClose }: AgentFilesGuideProps) {
  const [activeFile, setActiveFile] = useState(initialFile ?? ALL_FILE_NAMES[0]);
  const guide = FILE_GUIDES[activeFile];

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4">
      <div className="glass-heavy rounded-2xl w-full max-w-4xl h-[82vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/10 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-indigo-300" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">核心文件操作指南</h2>
            <p className="text-xs text-white/40">了解每个文件的用途、格式和最佳实践</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* File list */}
          <div className="w-40 shrink-0 border-r border-white/10 py-2 overflow-y-auto">
            {ALL_FILE_NAMES.map(name => (
              <button
                key={name}
                onClick={() => setActiveFile(name)}
                className={`w-full flex items-center gap-1.5 px-3 py-2.5 text-left transition-colors ${
                  name === activeFile
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'text-white/60 hover:bg-white/8'
                }`}
              >
                {name === activeFile && (
                  <ChevronRight className="w-3 h-3 shrink-0 text-indigo-400" />
                )}
                <span className={`text-xs font-mono truncate ${name === activeFile ? 'font-semibold' : ''}`}>
                  {name}
                </span>
              </button>
            ))}
          </div>

          {/* Guide content */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-6 max-w-2xl">
              {/* Title */}
              <div className="mb-5">
                <h3 className="text-lg font-bold text-white mb-0.5">{guide.title}</h3>
                <p className="text-sm font-medium text-indigo-300 mb-3">{guide.subtitle}</p>
                <p className="text-sm text-white/60 leading-relaxed">{guide.purpose}</p>
              </div>

              {/* Update frequency */}
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300 mb-5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span><strong>更新频率：</strong>{guide.updateFrequency}</span>
              </div>

              {/* Sections */}
              <div className="space-y-5 mb-6">
                {guide.sections.map((section, i) => (
                  <div key={i}>
                    <h4 className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-white/10 text-white/50 text-xs flex items-center justify-center font-bold shrink-0">
                        {i + 1}
                      </span>
                      {section.heading}
                    </h4>
                    <div className="text-sm text-white/60 leading-relaxed whitespace-pre-line pl-7">
                      {section.content}
                    </div>
                  </div>
                ))}
              </div>

              {/* Template */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-white/80 mb-2">模板示例</h4>
                <pre className="bg-black/40 text-emerald-300 text-xs rounded-xl p-4 overflow-x-auto leading-relaxed whitespace-pre-wrap font-mono">
                  {guide.template}
                </pre>
              </div>

              {/* Tips */}
              <div>
                <h4 className="text-sm font-semibold text-white/80 mb-2 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                  使用建议
                </h4>
                <ul className="space-y-2">
                  {guide.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-white/60">
                      <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
