import React from 'react';

interface ChartWrapperProps {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  height?: number | string;
  flex?: number;
}

const ChartWrapper: React.FC<ChartWrapperProps> = ({ title, icon: Icon, children, height = 300, flex = 1 }) => {
  return (
    <div className="card" style={{ 
      padding: '24px', 
      backgroundColor: 'var(--bg-secondary)', 
      borderRadius: 'var(--radius-lg)',
      display: 'flex',
      flexDirection: 'column',
      gap: '20px',
      flex,
      minWidth: '300px'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ 
          fontSize: '16px', 
          fontWeight: 700, 
          margin: 0, 
          display: 'flex', 
          alignItems: 'center', 
          gap: '8px',
          color: 'var(--text-primary)'
        }}>
          {Icon && <Icon size={18} style={{ color: 'var(--accent-purple)' }} />}
          {title}
        </h3>
      </div>
      
      <div style={{ width: '100%', height: height }}>
        {children}
      </div>
    </div>
  );
};

export default ChartWrapper;
