import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import LogAnalyzer from './pages/LogAnalyzer';
import CertMonitor from './pages/CertMonitor';
import DockerRegistry from './pages/DockerRegistry';
import SentinelOps from './pages/SentinelOps';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<LogAnalyzer />} />
          <Route path="/certs" element={<CertMonitor />} />
          <Route path="/registry" element={<DockerRegistry />} />
          <Route path="/assistant" element={<SentinelOps />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
