import React, { useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import NewProjectModal from './NewProjectModal';

const DashboardLayout = ({ children, title, subtitle }) => {
  const [showProjectModal, setShowProjectModal] = useState(false);

  return (
    <div className="page-layout">
      <Sidebar onNewProject={() => setShowProjectModal(true)} />
      <div className="main-content">
        <Topbar title={title} subtitle={subtitle} />
        <div className="page-body">{children}</div>
      </div>
      {showProjectModal && (
        <NewProjectModal onClose={() => setShowProjectModal(false)} />
      )}
    </div>
  );
};

export default DashboardLayout;
