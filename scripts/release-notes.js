// In ghi chú phát hành (dùng cho GitHub Release) từ whatsnew.json
const w = require('../whatsnew.json');
const sec = (t, a) => (a && a.length ? `### ${t}\n${a.map((x) => `- ${x}`).join('\n')}\n\n` : '');
process.stdout.write(sec('Mới', w.new) + sec('Cải thiện', w.improved) + sec('Sửa lỗi', w.fixed));
