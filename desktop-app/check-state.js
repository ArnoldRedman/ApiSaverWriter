// 在开发者工具控制台中执行这段代码来检查状态
console.log('=== LocalStorage projects ===');
console.log(localStorage.getItem('projects'));
console.log('=== Parsed projects ===');
try {
  const projects = JSON.parse(localStorage.getItem('projects') || '[]');
  console.log(projects);
} catch (e) {
  console.log('Error parsing:', e);
}
