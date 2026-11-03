package calc.service;

import calc.DTO.RivalryStatsDTO;
import calc.DTO.StatsDTO;
import calc.DTO.TournamentDTO;
import calc.DTO.UserDTO;
import calc.entity.*;
import calc.repository.RivalryStatsRepository;
import calc.repository.StatsRepository;
import calc.repository.TournamentRepository;
import calc.repository.UserRepository;
import org.modelmapper.ModelMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.text.ParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.stream.Collector;
import java.util.stream.Collectors;


/**
 * Created by clementperez on 9/23/16.
 */
@Service
public class RivalryStatsService {

    private static final Logger LOG = LoggerFactory.getLogger(RivalryStatsService.class);

    @Autowired
    private RivalryStatsRepository rivalryStatsRepository;
    @Autowired
    private TournamentRepository tournamentRepository;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private StatsService statsService;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private StatsRepository statsRepository;
    @Autowired
    private UserService userService;
    @Autowired
    private ModelMapper modelMapper;


    public List<RivalryStatsDTO> findByTournament(TournamentDTO tournament){
        return rivalryStatsRepository.findByTournament(tournamentRepository.findOne(tournament.getTournamentId())).stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<RivalryStatsDTO> findByUser(UserDTO user){
        return rivalryStatsRepository.findByUser(userRepository.findOne(user.getUserId())).stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<RivalryStatsDTO> findByUsername(String username){
        return rivalryStatsRepository.findByUser(userRepository.findByUserName(username)).stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<RivalryStatsDTO> findByRival(UserDTO user){
        return rivalryStatsRepository.findByRival(userRepository.findOne(user.getUserId())).stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public RivalryStatsDTO save(RivalryStatsDTO stats){
        try {
            return convertToDto(rivalryStatsRepository.save(convertToEntity(stats)));
        } catch (ParseException e) {
            e.printStackTrace();
        }
        return null;
    }

    public RivalryStats save(RivalryStats stats){
        return rivalryStatsRepository.save(stats);
    }

    public List<RivalryStatsDTO> findByUserAndTournament(Long userId, Long tournamentId){

        List<RivalryStats> rs = rivalryStatsRepository.findByUserUserIdAndTournamentTournamentId(userId, tournamentId);

        return rs.stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<RivalryStatsDTO> findByRivalAndTournament(Long userId, Long tournamentId){

        List<RivalryStats> rs = rivalryStatsRepository.findByRivalUserIdAndTournamentTournamentId(userId, tournamentId);

        return rs.stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<RivalryStatsDTO> findByUserNameAndTournament(String username, String tournamentName){

        List<RivalryStats> rs = rivalryStatsRepository.findByUserUserNameAndTournamentName(username, tournamentName);
        return rs.stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<RivalryStatsDTO> findByRivalUserNameAndTournament(String username, String tournamentName){

        List<RivalryStats> rs = rivalryStatsRepository.findByRivalUserNameAndTournamentName(username, tournamentName);
        return rs.stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public RivalryStatsDTO findByUserAndRivalAndTournament(Long userId,Long rivalId, Long tournamentId){

        RivalryStats stats = rivalryStatsRepository.findByUserUserIdAndRivalUserIdAndTournamentTournamentId(userId, rivalId, tournamentId);

        return stats == null ? null : convertToDto(stats);
    }

    public RivalryStatsDTO findByStatsAndRival(Long statsId,Long rivalId){

        RivalryStats stats = rivalryStatsRepository.findByStatsStatsIdAndRivalUserId(statsId, rivalId);

        return stats == null ? null : convertToDto(stats);
    }

    public RivalryStatsDTO findByUserNameAndRivalNameAndTournament(String username,String rivalName, String tournamentName){

        RivalryStats stats = rivalryStatsRepository.findByUserUserNameAndRivalUserNameAndTournamentName(username, rivalName, tournamentName);

        return stats == null ? null : convertToDto(stats);
    }

    public RivalryStatsDTO findByStatsAndRivalCreateIfNone(StatsDTO userStats, UserDTO rival){

        RivalryStatsDTO rivalryStats = findByUserAndRivalAndTournament(userStats.getUser().getUserId(), rival.getUserId(), userStats.getTournament().getTournamentId());

        if(rivalryStats != null){
            return rivalryStats;
        }

        User u = null;
        Stats s = null;
        try {
            u = userService.convertToEntity(userStats.getUser());
            s = statsService.convertToEntity(userStats);
        } catch (ParseException e) {
            e.printStackTrace();
        }
        User r = userRepository.findOne(rival.getUserId());

        return convertToDto(rivalryStatsRepository.save(new RivalryStats(u,r,s)));
    }

    protected RivalryStats recalculateAfterOutcome(Outcome outcome1, Outcome outcome2){
        RivalryStats rivalryStats = rivalryStatsRepository.findByUserUserIdAndRivalUserIdAndTournamentTournamentId(
                outcome1.getUser().getUserId(),
                outcome2.getUser().getUserId(),
                outcome1.getGame().getTournament().getTournamentId());

        if(rivalryStats == null){
            Stats stats = statsRepository.findByUserUserNameAndTournamentName(outcome1.getUser().getUserName(),outcome1.getGame().getTournament().getName());
            rivalryStats = new RivalryStats(
                    outcome1.getUser(),
                    outcome2.getUser(),
                    stats);
        }

        rivalryStats.setScore(rivalryStats.getScore() + outcome1.getScoreValue());

        switch (outcome1.getResults()){
            case WIN:
                rivalryStats.addWin();
                break;
            case LOSS:
                rivalryStats.addLose();
                break;
            case TIE:
                rivalryStats.addTie();
                break;
            default:
                break;
        }

        return rivalryStats;
    }

    protected List<RivalryStats> recalculateAfterOutcomes(Outcome userOutcome, List<Outcome> opponentsOutcome){
        List<RivalryStats> rivalriesStats = new ArrayList<>();
        for(Outcome opponentOutcome : opponentsOutcome){
            rivalriesStats.add(recalculateAfterOutcome(userOutcome, opponentOutcome));
        }
        return rivalriesStats;
    }

    public List<RivalryStats> recalculateAfterGame(Game game){
        // add the game results to the stats

        List<Outcome> winnersOutcomes = game.getOutcomes().stream().filter(Outcome::isWin).collect(Collectors.toList());
        List<Outcome> losersOutcomes = game.getOutcomes().stream().filter(Outcome::isLoss).collect(Collectors.toList());
        List<Outcome> tiersOutcomes = game.getOutcomes().stream().filter(Outcome::isTie).collect(Collectors.toList());

        List<RivalryStats> listRs = new ArrayList<>();
        for(Outcome winnerOutcomes : winnersOutcomes){
            long userId = winnerOutcomes.getUser().getUserId();
            Outcome userOutcome = game.getOutcomes().stream().filter(o -> o.getUser().getUserId().equals(userId)).findFirst().get();
            listRs.addAll(this.recalculateAfterOutcomes(userOutcome, losersOutcomes));
        }
        for(Outcome loserOutcome : losersOutcomes){
            long userId = loserOutcome.getUser().getUserId();
            Outcome userOutcome = game.getOutcomes().stream().filter(o -> o.getUser().getUserId().equals(userId)).findFirst().get();
            listRs.addAll(this.recalculateAfterOutcomes(userOutcome, winnersOutcomes));
        }
        for(Outcome tierOutcome : tiersOutcomes){
            long userId = tierOutcome.getUser().getUserId();
            Outcome userOutcome = game.getOutcomes().stream().filter(o -> o.getUser().getUserId().equals(userId)).findFirst().get();
            listRs.addAll(this.recalculateAfterOutcomes(userOutcome, tiersOutcomes));
        }

        for (RivalryStats rs : listRs) {
            this.save(rs);
            statsRepository.save(statsService.recalculateBestRivalry(rs));
            statsRepository.save(statsService.recalculateWorstRivalry(rs));
        }

        return listRs;
    }

    public RivalryStats convertToEntity(RivalryStatsDTO rivalryStats) throws ParseException {

        //modelMapper.getConfiguration().setAmbiguityIgnored(true);
        RivalryStats stats = new RivalryStats(); //modelMapper.map(RivalryStatsDTO, RivalryStats.class);

        stats.setRivalryStatsId(rivalryStats.getRivalryStatsId());
        stats.setScore(rivalryStats.getScore());
        stats.setGameCount(rivalryStats.getGameCount());
        stats.setWinCount(rivalryStats.getWinCount());
        stats.setLoseCount(rivalryStats.getLoseCount());
        stats.setTieCount(rivalryStats.getTieCount());
        stats.setWinStreak(rivalryStats.getWinStreak());
        stats.setLoseStreak(rivalryStats.getLoseStreak());
        stats.setTieStreak(rivalryStats.getTieStreak());
        stats.setLonguestWinStreak(rivalryStats.getLonguestWinStreak());
        stats.setLonguestLoseStreak(rivalryStats.getLonguestLoseStreak());
        stats.setLonguestTieStreak(rivalryStats.getLonguestTieStreak());
        stats.setBestScore(rivalryStats.getBestScore());
        stats.setWorstScore(rivalryStats.getWorstScore());
        if(rivalryStats.getRivalryStatsId() != null) {
            stats.setTournament(rivalryStatsRepository.findOne(rivalryStats.getRivalryStatsId()).getTournament());
            stats.setStats(statsRepository.findByUserUserIdAndTournamentTournamentId(rivalryStats.getUser().getUserId(), rivalryStats.getTournament().getTournamentId()));
            stats.setUser(rivalryStatsRepository.findOne(rivalryStats.getRivalryStatsId()).getUser());
            stats.setRival(rivalryStatsRepository.findOne(rivalryStats.getRivalryStatsId()).getRival());
        }

        return stats;
    }

    public RivalryStatsDTO convertToDto(RivalryStats stats) {

        RivalryStatsDTO rivalryStatsDTO = new RivalryStatsDTO(); //modelMapper.map(stats, RivalryStatsDTO.class);

        rivalryStatsDTO.setRivalryStatsId(stats.getRivalryStatsId());
        rivalryStatsDTO.setScore(stats.getScore());
        rivalryStatsDTO.setGameCount(stats.getGameCount());
        rivalryStatsDTO.setWinCount(stats.getWinCount());
        rivalryStatsDTO.setLoseCount(stats.getLoseCount());
        rivalryStatsDTO.setTieCount(stats.getTieCount());
        rivalryStatsDTO.setWinStreak(stats.getWinStreak());
        rivalryStatsDTO.setLoseStreak(stats.getLoseStreak());
        rivalryStatsDTO.setTieStreak(stats.getTieStreak());
        rivalryStatsDTO.setLonguestWinStreak(stats.getLonguestWinStreak());
        rivalryStatsDTO.setLonguestLoseStreak(stats.getLonguestLoseStreak());
        rivalryStatsDTO.setLonguestTieStreak(stats.getLonguestTieStreak());
        rivalryStatsDTO.setBestScore(stats.getBestScore());
        rivalryStatsDTO.setWorstScore(stats.getWorstScore());
        rivalryStatsDTO.setUser(userService.convertToDto(stats.getUser()));
        rivalryStatsDTO.setRival(userService.convertToDto(stats.getRival()));
        rivalryStatsDTO.setTournament(tournamentService.convertToDto(stats.getTournament()));
        //rivalryStatsDTO.setStats(statsService.convertToDto(stats.getStats()));

        return rivalryStatsDTO;
    }
}
