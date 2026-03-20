// OpenSky blocks cloud provider IPs, so the proxy can't reach them.
// This endpoint just returns an error directing clients to use direct access.
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(503).json({
    error: 'OpenSky blocks cloud provider IPs. Use direct browser access.',
    useDirectAccess: true,
  });
}
