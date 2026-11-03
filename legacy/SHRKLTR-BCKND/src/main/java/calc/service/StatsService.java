package calc.service;

import calc.DTO.StatsDTO;
import calc.DTO.TournamentDTO;
import calc.DTO.UserDTO;
import calc.entity.*;
import calc.repository.RivalryStatsRepository;
import calc.repository.StatsRepository;
import calc.repository.TournamentRepository;
import calc.repository.UserRepository;
import org.modelmapper.ModelMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import javax.sound.midi.SysexMessage;
import java.text.ParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;


/**
 * Created by clementperez on 9/23/16.
 */
@Service
public class StatsService {

    @Autowired
    private StatsRepository statsRepository;
    @Autowired
    private TournamentRepository tournamentRepository;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private UserService userService;
    @Autowired
    private RivalryStatsService rivalryStatsService;
    @Autowired
    private RivalryStatsRepository rivalryStatsRepository;
    @Autowired
    private ModelMapper modelMapper;

    public List<StatsDTO> findByTournament(TournamentDTO tournament){
        return statsRepository.findByTournamentOrderByScoreDesc(tournamentRepository.findOne(tournament.getTournamentId())).stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<StatsDTO> findByUser(UserDTO user){
        return statsRepository.findByUser(userRepository.findOne(user.getUserId())).stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }

    public List<StatsDTO> findByUserName(String username){
        return statsRepository.findByUser(userRepository.findByUserName(username)).stream()
                .map(s -> convertToDto(s)).collect(Collectors.toList());
    }


    public StatsDTO save(StatsDTO stats){
        try {
            return convertToDto(statsRepository.save(convertToEntity(stats)));
        } catch (ParseException e) {
            e.printStackTrace();
        }
        return null;
    }

    public StatsDTO findByUserAndTournament(Long userId, Long tournamentId){

        Stats s = statsRepository.findByUserUserIdAndTournamentTournamentId(userId, tournamentId);
        return s == null ? null : convertToDto(s);
    }

    public StatsDTO findByUserNameAndTournament(String username, String tournamentName){

        Stats s = statsRepository.findByUserUserNameAndTournamentName(username, tournamentName);
        return s == null ? null : convertToDto(s);
    }

    public StatsDTO findByUserAndTournamentCreateIfNone(UserDTO user, TournamentDTO tournament){

        StatsDTO stats = findByUserAndTournament(user.getUserId(),tournament.getTournamentId());

        User u = userRepository.findOne(user.getUserId());
        Tournament t = tournamentRepository.findOne(tournament.getTournamentId());
        if(stats == null) {
            Stats s = new Stats(u,t);
            statsRepository.save(s);
            return convertToDto(s);
        }

        return stats;
    }

    public Stats recalculateAfterOutcome(Outcome outcome){
        Stats stats = statsRepository.findByUserUserIdAndTournamentTournamentId(outcome.getUser().getUserId(), outcome.getGame().getTournament().getTournamentId());

        if(stats == null){
            stats = new Stats(outcome.getUser(),outcome.getGame().getTournament());
        }

        stats.setScore(stats.getScore() + outcome.getScoreValue());

        switch (outcome.getResults()){
            case WIN:
                stats.addWin();
                break;
            case LOSS:
                stats.addLose();
                break;
            case TIE:
                stats.addTie();
                break;
            default:
                break;
        }
        return stats;
    }


    public List<Stats> recalculateAfterGame(Game g){
        List<Stats> stats = new ArrayList<>();
        for(Outcome outcome : g.getOutcomes()){
            stats.add(recalculateAfterOutcome(outcome));
        }
        return stats;
    }


    public Stats recalculateBestRivalry(RivalryStats rivalryStats){

        Double score = rivalryStats.getScore();
        Stats s = rivalryStats.getStats();
        RivalryStats bestRs = s.getBestRivalry();
        RivalryStats newBestRs = s.getBestRivalry();

        if(score > 0 && (bestRs == null || score > bestRs.getScore())) {// can be null if no games were won
            newBestRs = rivalryStats;
        }else if(bestRs != null && bestRs.getRivalryStatsId() == rivalryStats.getRivalryStatsId()){
            List<RivalryStats> rss = rivalryStatsRepository.findByStatsId(s.getStatsId());

            newBestRs = rss.stream()
                    .max(Comparator.comparing(RivalryStats::getScore))
                    .filter(rs -> rs.getScore() > 0)
                    .orElse(null);
        }

        if(bestRs != newBestRs){
            s.setBestRivalry(newBestRs);
        }

        return s;
    }

    public Stats recalculateWorstRivalry(RivalryStats rivalryStats){
        Double score = rivalryStats.getScore();
        Stats s = rivalryStats.getStats();
        RivalryStats worstRs = s.getWorstRivalry();
        RivalryStats newWorstRs = s.getWorstRivalry();

        if(score < 0 && (worstRs == null || score < worstRs.getScore())) {
            newWorstRs = rivalryStats;
        }else if(worstRs != null && worstRs.getRivalryStatsId() == rivalryStats.getRivalryStatsId()){
            // need to find next newWorstRivalry
            List<RivalryStats> rss = rivalryStatsRepository.findByStatsId(s.getStatsId());

            newWorstRs = rss.stream()
                    .min(Comparator.comparing(RivalryStats::getScore))
                    .filter(rs -> rs.getScore() < 0)
                    .orElse(null);
        }

        if(worstRs != newWorstRs){
            s.setWorstRivalry(newWorstRs);
        }

        return s;
    }

    public Stats convertToEntity(StatsDTO statsDto) throws ParseException {

        //modelMapper.getConfiguration().setAmbiguityIgnored(true);
        Stats stats = new Stats(); //modelMapper.map(statsDto, Stats.class);

        stats.setStatsId(statsDto.getStatsId());
        stats.setScore(statsDto.getScore());
        stats.setGameCount(statsDto.getGameCount());
        stats.setWinCount(statsDto.getWinCount());
        stats.setLoseCount(statsDto.getLoseCount());
        stats.setTieCount(statsDto.getTieCount());
        stats.setWinStreak(statsDto.getWinStreak());
        stats.setLoseStreak(statsDto.getLoseStreak());
        stats.setTieStreak(statsDto.getTieStreak());
        stats.setLonguestWinStreak(statsDto.getLonguestWinStreak());
        stats.setLonguestLoseStreak(statsDto.getLonguestLoseStreak());
        stats.setLonguestTieStreak(statsDto.getLonguestTieStreak());
        stats.setBestScore(statsDto.getBestScore());
        stats.setWorstScore(statsDto.getWorstScore());
        if(statsDto.getTournament() != null && statsDto.getTournament().getTournamentId() != null) {
            stats.setTournament(tournamentRepository.findOne(statsDto.getTournament().getTournamentId()));
        }
        if(statsDto.getUser() != null && statsDto.getUser().getUserId() != null){
            stats.setUser(userRepository.findOne(statsDto.getUser().getUserId()));
        }

        return stats;
    }

    public StatsDTO convertToDto(Stats stats) {

        StatsDTO statsDTO = new StatsDTO(); //modelMapper.map(stats, StatsDTO.class);

        statsDTO.setStatsId(stats.getStatsId());
        statsDTO.setScore(stats.getScore());
        statsDTO.setGameCount(stats.getGameCount());
        statsDTO.setWinCount(stats.getWinCount());
        statsDTO.setLoseCount(stats.getLoseCount());
        statsDTO.setTieCount(stats.getTieCount());
        statsDTO.setWinStreak(stats.getWinStreak());
        statsDTO.setLoseStreak(stats.getLoseStreak());
        statsDTO.setTieStreak(stats.getTieStreak());
        statsDTO.setLonguestWinStreak(stats.getLonguestWinStreak());
        statsDTO.setLonguestLoseStreak(stats.getLonguestLoseStreak());
        statsDTO.setLonguestTieStreak(stats.getLonguestTieStreak());
        statsDTO.setBestScore(stats.getBestScore());
        statsDTO.setWorstScore(stats.getWorstScore());
        statsDTO.setUser(userService.convertToDto(stats.getUser()));
        statsDTO.setTournament(tournamentService.convertToDto(stats.getTournament()));
        statsDTO.setTournament(tournamentService.convertToDto(stats.getTournament()));
        if(stats.getBestRivalry() != null)
            statsDTO.setBestRivalry(rivalryStatsService.convertToDto(stats.getBestRivalry()));
        if(stats.getWorstRivalry() != null)
            statsDTO.setWorstRivalry(rivalryStatsService.convertToDto(stats.getWorstRivalry()));

        return statsDTO;
    }
}
