import React from 'react';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
  trend?: {
    value: number;
    isUp: boolean;
  };
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon: Icon, color, trend, subtitle }) => {
  return (
    <div className="card" style={{ 
      padding: '24px', 
      backgroundColor: 'var(--bg-secondary)', 
      borderRadius: 'var(--radius-lg)', 
      borderLeft: `4px solid ${color}`,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {title}
        </span>
        <div style={{ 
          padding: '8px', 
          backgroundColor: `${color}15`, 
          borderRadius: '12px',
          color: color
        }}>
          <Icon size={20} />
        </div>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          {value}
        </h2>
        {trend && (
          <span style={{ 
            fontSize: '12px', 
            fontWeight: 700, 
            color: trend.isUp ? '#10b981' : '#ef4444',
            display: 'flex',
            alignItems: 'center'
          }}>
            {trend.isUp ? '↑' : '↓'} {trend.value}%
          </span>
        )}
      </div>
      
      {subtitle && (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          {subtitle}
        </span>
      )}

      {/* Subtle background decoration */}
      <div style={{
        position: 'absolute',
        right: '-10px',
        bottom: '-10px',
        opacity: 0.05,
        color: color,
        transform: 'rotate(-15deg)'
      }}>
        <Icon size={80} />
      </div>
    </div>
  );
};

export default StatCard;
