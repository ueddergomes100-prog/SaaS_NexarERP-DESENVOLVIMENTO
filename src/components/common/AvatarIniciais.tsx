import React from 'react';
import { corDoAvatar, iniciaisDoNome } from '../../utils/avatarDomain';

/** Quadradinho colorido com as iniciais do cliente (cores em visualDesktop.css). */
const AvatarIniciais: React.FC<{ nome?: string | null; className?: string }> = ({ nome, className }) => (
  <span className={`hd-avatar cor-${corDoAvatar(nome)}${className ? ` ${className}` : ''}`} aria-hidden="true">
    {iniciaisDoNome(nome)}
  </span>
);

export default AvatarIniciais;
