import { useState, useEffect, useCallback } from 'react';
import { client } from '../../api/gateway';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';

interface FileTreeProps {
  rootPath: string;
  onFileSelect: (path: string) => void;
  selectedPath?: string;
}

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
  isExpanded?: boolean;
}

const CORE_FILES = ['AGENTS.md', 'SOUL.md', 'USER.md', 'MEMORY.md', 'TOOLS.md', 'IDENTITY.md', 'HEARTBEAT.md'];

export function FileTree({ rootPath, onFileSelect, selectedPath }: FileTreeProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDirectory = useCallback(async (path: string): Promise<FileNode[]> => {
    try {
      const result = await client.invokeTool('exec', { 
        command: `ls -la "${path}"`
      });
      
      const lines = result.output?.split('\n').filter((line: string) => {
        // Skip empty lines, total, and . / ..
        return line.trim() && !line.startsWith('total') && !line.endsWith(' .') && !line.endsWith(' ..');
      }) || [];

      const nodes: FileNode[] = [];
      
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length < 9) continue;
        
        const permissions = parts[0];
        const name = parts.slice(8).join(' ');
        const isDirectory = permissions.startsWith('d');
        const fullPath = path.endsWith('/') ? `${path}${name}` : `${path}/${name}`;
        
        // Skip hidden files (except core files)
        if (name.startsWith('.') && !CORE_FILES.includes(name)) continue;
        
        nodes.push({
          name,
          path: fullPath,
          isDirectory,
          isExpanded: false,
          children: isDirectory ? [] : undefined
        });
      }

      // Sort: directories first, then files, then by name
      nodes.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      return nodes;
    } catch (err) {
      console.error('Failed to load directory:', err);
      return [];
    }
  }, []);

  const toggleExpand = async (node: FileNode, parentPath?: string) => {
    if (!node.isDirectory) {
      onFileSelect(node.path);
      return;
    }

    const newTree = [...tree];
    const updateNode = (nodes: FileNode[], targetPath: string): boolean => {
      for (const n of nodes) {
        if (n.path === targetPath) {
          n.isExpanded = !n.isExpanded;
          if (n.isExpanded && (!n.children || n.children.length === 0)) {
            // Load children on expand
            loadDirectory(n.path).then(children => {
              n.children = children;
              setTree([...newTree]);
            });
          }
          return true;
        }
        if (n.children && updateNode(n.children, targetPath)) {
          return true;
        }
      }
      return false;
    };

    updateNode(newTree, node.path);
    setTree(newTree);
  };

  useEffect(() => {
    setLoading(true);
    loadDirectory(rootPath).then(nodes => {
      setTree(nodes);
      setLoading(false);
    });
  }, [rootPath, loadDirectory]);

  const isCoreFile = (name: string) => CORE_FILES.includes(name);

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isSelected = node.path === selectedPath;
    const paddingLeft = depth * 16 + 8;

    return (
      <div key={node.path}>
        <div
          className={`
            flex items-center py-1 px-2 cursor-pointer text-sm hover:bg-gray-100
            ${isSelected ? 'bg-blue-50 text-blue-600' : 'text-gray-700'}
            ${isCoreFile(node.name) && !node.isDirectory ? 'font-medium' : ''}
          `}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => toggleExpand(node)}
        >
          <span className="mr-1 w-4 h-4 flex items-center justify-center">
            {node.isDirectory ? (
              node.isExpanded ? (
                <ChevronDown className="w-4 h-4 text-gray-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-gray-500" />
              )
            ) : (
              <span className="w-4" />
            )}
          </span>
          
          {node.isDirectory ? (
            <Folder className="w-4 h-4 mr-2 text-yellow-500" />
          ) : (
            <File className={`
              w-4 h-4 mr-2 
              ${isCoreFile(node.name) ? 'text-blue-500' : 'text-gray-400'}
            `} />
          )}
          
          <span className={`
            truncate
            ${isCoreFile(node.name) && !node.isDirectory ? 'text-blue-600' : ''}
          `}>
            {node.name}
          </span>
          
          {isCoreFile(node.name) && !node.isDirectory && (
            <span className="ml-2 text-xs text-blue-400">(core)</span>
          )}
        </div>
        
        {node.isDirectory && node.isExpanded && node.children && (
          <div>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500">
        Loading directory...
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <div className="p-2 text-xs text-gray-400 border-b border-gray-200 mb-2">
        {rootPath}
      </div>
      {tree.length === 0 ? (
        <div className="p-4 text-sm text-gray-400">
          No files found
        </div>
      ) : (
        tree.map(node => renderNode(node))
      )}
    </div>
  );
}
