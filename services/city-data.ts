// City data organized by country -> province/state -> cities

export interface CityEntry {
  province: string
  cities: string[]
}

// China cities by province (simplified, major cities)
const CN_CITIES: CityEntry[] = [
  { province: '北京', cities: ['东城区', '西城区', '朝阳区', '海淀区', '丰台区', '石景山区', '通州区', '大兴区', '顺义区', '昌平区'] },
  { province: '上海', cities: ['黄浦区', '徐汇区', '长宁区', '静安区', '普陀区', '虹口区', '杨浦区', '浦东新区', '闵行区', '宝山区'] },
  { province: '广东', cities: ['广州', '深圳', '珠海', '佛山', '东莞', '中山', '惠州', '汕头', '江门', '湛江'] },
  { province: '浙江', cities: ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '衢州', '舟山', '台州'] },
  { province: '江苏', cities: ['南京', '苏州', '无锡', '常州', '镇江', '南通', '扬州', '徐州', '盐城', '泰州'] },
  { province: '山东', cities: ['济南', '青岛', '烟台', '威海', '潍坊', '淄博', '临沂', '济宁', '泰安', '日照'] },
  { province: '四川', cities: ['成都', '绵阳', '德阳', '宜宾', '南充', '泸州', '乐山', '自贡', '眉山', '达州'] },
  { province: '湖北', cities: ['武汉', '宜昌', '襄阳', '荆州', '黄石', '十堰', '鄂州', '荆门', '孝感', '黄冈'] },
  { province: '湖南', cities: ['长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州'] },
  { province: '福建', cities: ['福州', '厦门', '泉州', '漳州', '龙岩', '三明', '南平', '莆田', '宁德'] },
  { province: '河南', cities: ['郑州', '洛阳', '开封', '南阳', '许昌', '新乡', '安阳', '商丘', '焦作', '平顶山'] },
  { province: '河北', cities: ['石家庄', '唐山', '保定', '邯郸', '廊坊', '沧州', '邢台', '衡水', '秦皇岛', '承德'] },
  { province: '陕西', cities: ['西安', '咸阳', '宝鸡', '渭南', '延安', '汉中', '榆林', '安康', '商洛', '铜川'] },
  { province: '辽宁', cities: ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳'] },
  { province: '安徽', cities: ['合肥', '芜湖', '蚌埠', '淮南', '马鞍山', '淮北', '安庆', '黄山', '滁州', '阜阳'] },
  { province: '重庆', cities: ['渝中区', '江北区', '南岸区', '沙坪坝区', '九龙坡区', '大渡口区', '北碚区', '渝北区', '巴南区', '万州区'] },
  { province: '天津', cities: ['和平区', '河东区', '河西区', '南开区', '河北区', '红桥区', '东丽区', '西青区', '津南区', '北辰区'] },
  { province: '江西', cities: ['南昌', '九江', '景德镇', '萍乡', '新余', '鹰潭', '赣州', '吉安', '宜春', '抚州'] },
  { province: '云南', cities: ['昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧', '大理', '楚雄'] },
  { province: '贵州', cities: ['贵阳', '六盘水', '遵义', '安顺', '毕节', '铜仁', '黔东南', '黔南', '黔西南'] },
  { province: '黑龙江', cities: ['哈尔滨', '齐齐哈尔', '鸡西', '鹤岗', '双鸭山', '大庆', '伊春', '佳木斯', '牡丹江', '黑河'] },
  { province: '吉林', cities: ['长春', '吉林', '四平', '辽源', '通化', '白山', '松原', '白城', '延边'] },
  { province: '山西', cities: ['太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾'] },
  { province: '甘肃', cities: ['兰州', '嘉峪关', '金昌', '白银', '天水', '武威', '张掖', '平凉', '酒泉', '庆阳'] },
  { province: '内蒙古', cities: ['呼和浩特', '包头', '乌海', '赤峰', '通辽', '鄂尔多斯', '呼伦贝尔', '巴彦淖尔', '乌兰察布'] },
  { province: '新疆', cities: ['乌鲁木齐', '克拉玛依', '吐鲁番', '哈密', '昌吉', '博尔塔拉', '巴音郭楞', '阿克苏', '喀什', '伊犁'] },
  { province: '广西', cities: ['南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色'] },
  { province: '海南', cities: ['海口', '三亚', '三沙', '儋州', '五指山', '琼海', '文昌', '万宁', '东方'] },
  { province: '西藏', cities: ['拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里'] },
  { province: '宁夏', cities: ['银川', '石嘴山', '吴忠', '固原', '中卫'] },
  { province: '青海', cities: ['西宁', '海东', '海北', '黄南', '海南州', '果洛', '玉树', '海西'] },
  { province: '台湾', cities: ['台北', '高雄', '台中', '台南', '基隆', '新竹', '嘉义', '桃园', '新北'] },
  { province: '香港', cities: ['中西区', '湾仔区', '东区', '南区', '油尖旺区', '深水埗区', '九龙城区', '观塘区', '沙田区'] },
  { province: '澳门', cities: ['花地玛堂区', '圣安多尼堂区', '大堂区', '望德堂区', '风顺堂区', '嘉模堂区', '圣方济各堂区'] },
]

// US cities by state
const US_CITIES: CityEntry[] = [
  { province: 'California', cities: ['Los Angeles', 'San Francisco', 'San Diego', 'San Jose', 'Sacramento', 'Fresno', 'Oakland', 'Palo Alto', 'Santa Monica', 'Pasadena'] },
  { province: 'New York', cities: ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse', 'Yonkers', 'Ithaca', 'White Plains', 'Saratoga Springs'] },
  { province: 'Texas', cities: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth', 'El Paso', 'Arlington', 'Corpus Christi', 'Plano', 'Lubbock'] },
  { province: 'Florida', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Fort Lauderdale', 'Tallahassee', 'St. Petersburg', 'Key West', 'Pensacola'] },
  { province: 'Illinois', cities: ['Chicago', 'Springfield', 'Peoria', 'Rockford', 'Champaign', 'Naperville', 'Evanston', 'Joliet', 'Bloomington'] },
  { province: 'Pennsylvania', cities: ['Philadelphia', 'Pittsburgh', 'Harrisburg', 'Allentown', 'Erie', 'Scranton', 'Bethlehem', 'Lancaster', 'Reading'] },
  { province: 'Ohio', cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo', 'Akron', 'Dayton', 'Youngstown', 'Canton', 'Parma'] },
  { province: 'Georgia', cities: ['Atlanta', 'Savannah', 'Augusta', 'Athens', 'Macon', 'Columbus', 'Roswell', 'Sandy Springs', 'Alpharetta'] },
  { province: 'Washington', cities: ['Seattle', 'Spokane', 'Tacoma', 'Bellevue', 'Vancouver', 'Olympia', 'Redmond', 'Kirkland', 'Everett'] },
  { province: 'Massachusetts', cities: ['Boston', 'Worcester', 'Cambridge', 'Springfield', 'Lowell', 'Quincy', 'Newton', 'Somerville', 'Brookline'] },
]

// JP cities by prefecture
const JP_CITIES: CityEntry[] = [
  { province: '东京都', cities: ['新宿区', '渋谷区', '港区', '千代田区', '中央区', '台東区', '墨田区', '江東区', '品川区', '目黒区'] },
  { province: '大阪府', cities: ['大阪市', '堺市', '豊中市', '吹田市', '高槻市', '枚方市', '茨木市', '八尾市', '寝屋川市'] },
  { province: '京都府', cities: ['京都市', '宇治市', '亀岡市', '舞鶴市', '福知山市', '長岡京市', '京田辺市', '城陽市'] },
  { province: '北海道', cities: ['札幌市', '函館市', '旭川市', '小樽市', '帯広市', '釧路市', '苫小牧市', '室蘭市', '北見市'] },
  { province: '愛知県', cities: ['名古屋市', '豊田市', '岡崎市', '豊橋市', '一宮市', '春日井市', '安城市', '西尾市'] },
  { province: '神奈川県', cities: ['横浜市', '川崎市', '相模原市', '横須賀市', '鎌倉市', '藤沢市', '茅ヶ崎市', '厚木市'] },
  { province: '福岡県', cities: ['福岡市', '北九州市', '久留米市', '飯塚市', '大牟田市', '春日市', '筑紫野市'] },
  { province: '兵庫県', cities: ['神戸市', '姫路市', '尼崎市', '西宮市', '明石市', '加古川市', '宝塚市', '伊丹市'] },
  { province: '沖縄県', cities: ['那覇市', '沖縄市', 'うるま市', '宜野湾市', '浦添市', '名護市', '糸満市'] },
]

// GB cities by region
const GB_CITIES: CityEntry[] = [
  { province: 'England', cities: ['London', 'Manchester', 'Birmingham', 'Liverpool', 'Leeds', 'Sheffield', 'Bristol', 'Newcastle', 'Nottingham', 'Southampton'] },
  { province: 'Scotland', cities: ['Edinburgh', 'Glasgow', 'Aberdeen', 'Dundee', 'Inverness', 'Stirling', 'Perth'] },
  { province: 'Wales', cities: ['Cardiff', 'Swansea', 'Newport', 'Bangor', 'St Davids', 'Wrexham'] },
  { province: 'Northern Ireland', cities: ['Belfast', 'Derry', 'Lisburn', 'Newry', 'Armagh', 'Bangor'] },
]

// All city data
export const CITY_DATA: Record<string, CityEntry[]> = {
  CN: CN_CITIES,
  US: US_CITIES,
  JP: JP_CITIES,
  GB: GB_CITIES,
}

export function getAllProvinces(country: string): string[] {
  const entries = CITY_DATA[country] || CN_CITIES
  return entries.map(e => e.province)
}

export function getCitiesByProvince(country: string, province: string): string[] {
  const entries = CITY_DATA[country] || CN_CITIES
  const entry = entries.find(e => e.province === province)
  return entry?.cities || entries[0].cities
}

export function getCityProvince(country: string, city: string): string {
  const entries = CITY_DATA[country] || CN_CITIES
  for (const entry of entries) {
    if (entry.cities.includes(city)) return entry.province
  }
  return entries[0].province
}
